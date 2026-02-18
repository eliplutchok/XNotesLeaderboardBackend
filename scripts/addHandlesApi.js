const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const axios = require('axios');
const { sequelize, Note, NoteStatus } = require('../models/AllModels');
const { Sequelize } = require('sequelize');

let HANDLES_TO_PROCESS = null;
let NOT_FOUND = 'not found once';
// let HANDLES_TO_PROCESS = "not found once";
// let NOT_FOUND = 'not found twice';
// let HANDLES_TO_PROCESS = "not found twice";
// let NOT_FOUND = 'not found thrice';

const BATCH_SIZE = 100; // X API max IDs per request
const DELAY_BETWEEN_BATCHES_MS = 1000;

async function fetchTweetAuthors(tweetIds) {
    const res = await axios.get('https://api.x.com/2/tweets', {
        params: {
            ids: tweetIds.join(','),
            'tweet.fields': 'author_id',
            'expansions': 'author_id',
            'user.fields': 'username'
        },
        headers: { Authorization: `Bearer ${process.env.X_API_TOKEN}` }
    });

    const userMap = {};
    if (res.data.includes && res.data.includes.users) {
        for (const user of res.data.includes.users) {
            userMap[user.id] = user.username;
        }
    }

    const tweetHandleMap = {};
    if (res.data.data) {
        for (const tweet of res.data.data) {
            const username = userMap[tweet.author_id];
            tweetHandleMap[tweet.id] = username ? `@${username}` : null;
        }
    }

    return tweetHandleMap;
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function addHandles(max_notes = 3500) {
    try {
        await sequelize.authenticate();
        console.log('Connected to database');

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
            const tweetIds = batch.map(note => note.tweetId.toString());

            let tweetHandleMap = {};

            try {
                tweetHandleMap = await fetchTweetAuthors(tweetIds);
            } catch (error) {
                if (error.response) {
                    console.error(`Batch ${batchNum}/${totalBatches} API error:`, error.response.status, error.response.data);

                    // If rate limited, wait and retry once
                    if (error.response.status === 429) {
                        const resetTime = error.response.headers['x-rate-limit-reset'];
                        const waitMs = resetTime
                            ? (parseInt(resetTime) * 1000 - Date.now()) + 1000
                            : 60000;
                        console.log(`Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s...`);
                        await sleep(waitMs);

                        try {
                            tweetHandleMap = await fetchTweetAuthors(tweetIds);
                        } catch (retryError) {
                            console.error(`Batch ${batchNum} retry failed:`, retryError.response?.data || retryError.message);
                        }
                    }
                } else {
                    console.error(`Batch ${batchNum}/${totalBatches} error:`, error.message);
                }

                // Any tweets not resolved after errors get marked not found
                if (Object.keys(tweetHandleMap).length === 0) {
                    batchErrors++;
                }
            }

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
    }
}

if (require.main === module) {
    addHandles(10)
        .then(() => sequelize.close())
        .catch(console.error);
}

module.exports = addHandles;
