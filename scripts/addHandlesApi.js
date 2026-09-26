const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const axios = require('axios');
const { sequelize, Note, NoteStatus } = require('../models/AllModels');
const { Sequelize } = require('sequelize');
const { ensureTweetAuthorsTable, recordTweetAuthors, statusFromErrorTitle } = require('./tweetAuthors');

let HANDLES_TO_PROCESS = null;
let NOT_FOUND = 'not found once';
// let HANDLES_TO_PROCESS = "not found once";
// let NOT_FOUND = 'not found twice';
// let HANDLES_TO_PROCESS = "not found twice";
// let NOT_FOUND = 'not found thrice';

const BATCH_SIZE = 100; // X API max IDs per request
const DELAY_BETWEEN_BATCHES_MS = 1000;
// Auth and billing failures affect every request, so continuing would only
// burn through the remaining notes without resolving anything.
const FATAL_STATUSES = new Set([401, 402, 403]);

async function fetchTweetAuthors(tweetIds) {
    const res = await axios.get('https://api.x.com/2/tweets', {
        params: {
            ids: tweetIds.join(','),
            'tweet.fields': 'author_id',
            'expansions': 'author_id',
            'user.fields': 'username,created_at'
        },
        headers: { Authorization: `Bearer ${process.env.X_API_TOKEN}` }
    });

    const userMap = {};
    for (const user of res.data.includes?.users || []) {
        userMap[user.id] = user;
    }

    const tweetHandleMap = {};
    const authorRows = new Map();
    for (const tweet of res.data.data || []) {
        const user = userMap[tweet.author_id];
        const handle = user ? `@${user.username}` : null;
        tweetHandleMap[tweet.id] = handle;
        authorRows.set(tweet.id, {
            tweetId: tweet.id,
            authorId: tweet.author_id,
            handle,
            authorCreatedAt: user?.created_at,
            source: 'tweet_lookup',
            status: 'found'
        });
    }

    for (const error of res.data.errors || []) {
        if (error.parameter !== 'ids' || !error.value || authorRows.has(error.value)) continue;
        authorRows.set(error.value, {
            tweetId: error.value,
            source: 'tweet_lookup',
            status: statusFromErrorTitle(error.title),
            errorTitle: error.title,
            errorDetail: error.detail
        });
    }

    for (const tweetId of tweetIds) {
        if (!authorRows.has(tweetId)) {
            authorRows.set(tweetId, {
                tweetId,
                source: 'tweet_lookup',
                status: 'error',
                errorDetail: 'missing from both data and errors in the X response'
            });
        }
    }

    return { tweetHandleMap, authorRows: [...authorRows.values()] };
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function addHandles(max_notes = 3500) {
    try {
        await sequelize.authenticate();
        console.log('Connected to database');
        await ensureTweetAuthorsTable();

        const notes = await Note.findAll({
            include: [{
                model: NoteStatus,
                where: {
                    currentStatus: 'CURRENTLY_RATED_HELPFUL',
                    noteId: {
                        [Sequelize.Op.col]: 'Note.noteId'
                    }
                },
                required: true
            }],
            where: {
                handle: HANDLES_TO_PROCESS
            }
        });

        console.log(`Found ${notes.length} notes to process`);

        const notesToProcess = notes.slice(0, max_notes);
        const totalBatches = Math.ceil(notesToProcess.length / BATCH_SIZE);

        let processed = 0;
        let found = 0;
        let notFound = 0;
        let batchErrors = 0;

        for (let i = 0; i < notesToProcess.length; i += BATCH_SIZE) {
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const batch = notesToProcess.slice(i, i + BATCH_SIZE);
            const tweetIds = [...new Set(batch.map(note => note.tweetId.toString()))];

            let result = null;

            try {
                result = await fetchTweetAuthors(tweetIds);
            } catch (error) {
                const status = error.response?.status;
                if (error.response) {
                    console.error(`Batch ${batchNum}/${totalBatches} API error:`, status, error.response.data);
                } else {
                    console.error(`Batch ${batchNum}/${totalBatches} error:`, error.message);
                }

                if (FATAL_STATUSES.has(status)) {
                    throw new Error(`X API returned ${status}; stopping so unresolved notes stay NULL and are retried next run`);
                }

                if (status === 429) {
                    const resetTime = error.response.headers['x-rate-limit-reset'];
                    const waitMs = resetTime
                        ? (parseInt(resetTime) * 1000 - Date.now()) + 1000
                        : 60000;
                    console.log(`Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s...`);
                    await sleep(waitMs);

                    try {
                        result = await fetchTweetAuthors(tweetIds);
                    } catch (retryError) {
                        console.error(`Batch ${batchNum} retry failed:`, retryError.response?.data || retryError.message);
                    }
                }
            }

            // A failed request says nothing about whether the tweets exist, so
            // leave the handles NULL for the next run instead of marking them.
            if (result === null) {
                batchErrors++;
                console.log(`Batch ${batchNum}/${totalBatches} skipped; ${batch.length} notes left for the next run`);
                continue;
            }

            // Recorded before the handles so a failure here leaves the notes
            // NULL and the whole batch is retried, rather than losing the IDs.
            await recordTweetAuthors(result.authorRows);
            const { tweetHandleMap } = result;

            for (const note of batch) {
                const tweetId = note.tweetId.toString();
                const handle = tweetHandleMap[tweetId] || NOT_FOUND;

                await note.update({ handle });

                if (handle === NOT_FOUND) {
                    notFound++;
                } else {
                    found++;
                }
                processed++;
                console.log(`  ${processed}. tweet: ${tweetId} -> ${handle}`);
            }

            console.log(`Batch ${batchNum}/${totalBatches} | processed: ${processed}/${notesToProcess.length} | found: ${found} | not found: ${notFound}`);

            if (i + BATCH_SIZE < notesToProcess.length) {
                await sleep(DELAY_BETWEEN_BATCHES_MS);
            }
        }

        console.log('\n--- Summary ---');
        console.log(`Total processed: ${processed}`);
        console.log(`Handles found: ${found}`);
        console.log(`Not found: ${notFound}`);
        console.log(`Batch errors: ${batchErrors}`);

    } catch (error) {
        console.error(error);
        throw error;
    }
}

if (require.main === module) {
    addHandles(10)
        .then(() => sequelize.close())
        .catch(console.error);
}

module.exports = addHandles;
module.exports.fetchTweetAuthors = fetchTweetAuthors;
