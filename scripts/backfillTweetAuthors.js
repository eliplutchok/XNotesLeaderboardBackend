/**
 * Backfills tweet_authors for tweets looked up before author IDs were stored.
 * Dry-run by default (no API calls, no writes). Pass --apply to run.
 *
 *   --mode=handles  Resolve stored @handles to user IDs (GET /2/users/by) and
 *                   apply the result to every tweet noted under that handle.
 *                   A handle is rejected for a tweet when the account it now
 *                   belongs to was created after the tweet (handle reassigned).
 *   --mode=recover  Look up tweets whose handle lookup failed (GET /2/tweets),
 *                   which recovers authors who renamed since we saw them.
 *   --mode=recheck  Look up tweets that only ever got a 'not found*' marker,
 *                   many of which date from the scraper era and still exist.
 *
 *   --limit=N       Handles (handles mode) or tweets (other modes) to process.
 *   --sample        Pick at random instead of in a stable order, for estimates.
 *
 *   node scripts/backfillTweetAuthors.js --mode=handles --limit=2000 --sample
 *   node scripts/backfillTweetAuthors.js --mode=handles --limit=2000 --sample --apply
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const axios = require('axios');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/AllModels');
const {
    ensureTweetAuthorsTable,
    recordTweetAuthors,
    statusFromErrorTitle,
    tweetCreatedAt,
} = require('./tweetAuthors');

const BATCH_SIZE = 100; // X API max IDs/usernames per request
const DELAY_BETWEEN_BATCHES_MS = 1000;
const FATAL_STATUSES = new Set([401, 402, 403]);
const USER_READ_COST = 0.010;
const POST_READ_COST = 0.005;
const SENTINELS = ['not found once', 'not found twice', 'not found', 'not found thrice'];

function parseArgs(argv) {
    const args = { mode: null, limit: 1000, sample: false, apply: false };
    for (const arg of argv) {
        if (arg === '--apply') args.apply = true;
        else if (arg === '--sample') args.sample = true;
        else if (arg.startsWith('--mode=')) args.mode = arg.slice('--mode='.length);
        else if (arg.startsWith('--limit=')) {
            args.limit = parseInt(arg.slice('--limit='.length), 10);
            if (!Number.isInteger(args.limit) || args.limit <= 0) throw new Error(`Invalid ${arg}`);
        } else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!['handles', 'recover', 'recheck'].includes(args.mode)) {
        throw new Error('Pass --mode=handles, --mode=recover or --mode=recheck');
    }
    return args;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function xGet(url, params) {
    for (let attempt = 1; ; attempt++) {
        try {
            const res = await axios.get(url, {
                params,
                headers: { Authorization: `Bearer ${process.env.X_API_TOKEN}` }
            });
            return res.data;
        } catch (error) {
            const status = error.response?.status;
            if (FATAL_STATUSES.has(status)) {
                throw new Error(`X API returned ${status}: ${JSON.stringify(error.response.data)}`);
            }
            if (status === 429 && attempt < 3) {
                const reset = error.response.headers['x-rate-limit-reset'];
                const waitMs = reset ? parseInt(reset, 10) * 1000 - Date.now() + 1000 : 60000;
                console.log(`  Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s...`);
                await sleep(waitMs);
                continue;
            }
            throw error;
        }
    }
}

function bump(counter, key, by = 1) {
    counter[key] = (counter[key] || 0) + by;
}

// ---------------------------------------------------------------- handles mode

async function selectHandles({ limit, sample }) {
    // Handles with at least one tweet that has no tweet_authors row yet, so a
    // full run can be resumed by simply running it again.
    return sequelize.query(
        `SELECT h.handle_key AS "handleKey", COUNT(*)::int AS "tweetCount"
         FROM (
             SELECT DISTINCT lower(substr(n.handle, 2)) AS handle_key, n."tweetId"
             FROM notes n
             LEFT JOIN tweet_authors ta ON ta."tweetId" = n."tweetId"
             WHERE n.handle LIKE '@%' AND ta."tweetId" IS NULL
         ) h
         GROUP BY h.handle_key
         ORDER BY ${sample ? 'random()' : 'h.handle_key'}
         LIMIT :limit`,
        { replacements: { limit }, type: QueryTypes.SELECT }
    );
}

async function tweetsForHandles(handleKeys) {
    return sequelize.query(
        `SELECT DISTINCT n."tweetId"::text AS "tweetId", lower(substr(n.handle, 2)) AS "handleKey"
         FROM notes n
         LEFT JOIN tweet_authors ta ON ta."tweetId" = n."tweetId"
         WHERE n.handle LIKE '@%'
           AND lower(substr(n.handle, 2)) = ANY(CAST(:handleKeys AS text[]))
           AND ta."tweetId" IS NULL`,
        { replacements: { handleKeys: `{${handleKeys.map(h => `"${h}"`).join(',')}}` }, type: QueryTypes.SELECT }
    );
}

async function lookupHandles(handleKeys) {
    const users = new Map();   // handleKey -> user
    const failures = new Map(); // handleKey -> { status, title, detail }
    let usersReturned = 0;

    for (let i = 0; i < handleKeys.length; i += BATCH_SIZE) {
        const batch = handleKeys.slice(i, i + BATCH_SIZE);
        const data = await xGet('https://api.x.com/2/users/by', {
            usernames: batch.join(','),
            'user.fields': 'created_at'
        });

        for (const user of data.data || []) {
            users.set(user.username.toLowerCase(), user);
            usersReturned++;
        }
        for (const error of data.errors || []) {
            if (!error.value) continue;
            failures.set(String(error.value).toLowerCase(), {
                status: statusFromErrorTitle(error.title),
                title: error.title,
                detail: error.detail
            });
        }

        console.log(`  users batch ${i / BATCH_SIZE + 1}/${Math.ceil(handleKeys.length / BATCH_SIZE)} | resolved ${users.size}`);
        if (i + BATCH_SIZE < handleKeys.length) await sleep(DELAY_BETWEEN_BATCHES_MS);
    }

    return { users, failures, usersReturned };
}

async function runHandles(args) {
    const handles = await selectHandles(args);
    const handleKeys = handles.map(h => h.handleKey);
    const tweetsInScope = handles.reduce((sum, h) => sum + h.tweetCount, 0);

    console.log(`Handles selected: ${handleKeys.length} (covering ${tweetsInScope} tweets)`);
    console.log(`Requests: ${Math.ceil(handleKeys.length / BATCH_SIZE)} | max cost: $${(handleKeys.length * USER_READ_COST).toFixed(2)}`);
    if (!args.apply) return { dryRun: true, handles: handleKeys.length, tweetsInScope };

    const { users, failures, usersReturned } = await lookupHandles(handleKeys);
    const tweets = await tweetsForHandles(handleKeys);

    const handleOutcomes = {};
    for (const key of handleKeys) {
        bump(handleOutcomes, users.has(key) ? 'resolved' : (failures.get(key)?.status || 'missing_from_response'));
    }

    const tweetOutcomes = {};
    const rows = tweets.map(({ tweetId, handleKey }) => {
        const user = users.get(handleKey);
        if (user) {
            const tweetTime = tweetCreatedAt(tweetId);
            if (new Date(user.created_at) > tweetTime) {
                bump(tweetOutcomes, 'handle_reassigned');
                return {
                    tweetId, source: 'handle_lookup', status: 'handle_reassigned',
                    errorDetail: `@${user.username} now belongs to account ${user.id}, created ${user.created_at}, after the tweet (${tweetTime.toISOString()})`
                };
            }
            bump(tweetOutcomes, 'found');
            return {
                tweetId, authorId: user.id, handle: `@${user.username}`, authorCreatedAt: user.created_at,
                source: 'handle_lookup', status: 'found'
            };
        }
        const failure = failures.get(handleKey) || { status: 'error', detail: 'handle missing from both data and errors in the X response' };
        bump(tweetOutcomes, failure.status);
        return {
            tweetId, source: 'handle_lookup', status: failure.status,
            errorTitle: failure.title, errorDetail: failure.detail
        };
    });

    for (let i = 0; i < rows.length; i += 5000) {
        await recordTweetAuthors(rows.slice(i, i + 5000));
    }

    return {
        handles: handleKeys.length,
        usersReturned,
        cost: usersReturned * USER_READ_COST,
        handleOutcomes,
        tweets: rows.length,
        tweetOutcomes
    };
}

// ------------------------------------------------------ recover/recheck modes

async function selectTweets({ mode, limit, sample }) {
    const order = sample ? 'random()' : '"tweetId"';
    if (mode === 'recover') {
        return sequelize.query(
            `SELECT "tweetId"::text AS "tweetId" FROM tweet_authors
             WHERE source = 'handle_lookup' AND "authorId" IS NULL
             ORDER BY ${order} LIMIT :limit`,
            { replacements: { limit }, type: QueryTypes.SELECT }
        );
    }
    return sequelize.query(
        `SELECT t."tweetId"::text AS "tweetId" FROM (
             SELECT n."tweetId" FROM notes n
             LEFT JOIN tweet_authors ta ON ta."tweetId" = n."tweetId"
             WHERE ta."tweetId" IS NULL
             GROUP BY n."tweetId"
             HAVING bool_and(n.handle IN (:sentinels)) AND bool_or(n.handle IS NOT NULL)
         ) t
         ORDER BY ${order} LIMIT :limit`,
        { replacements: { limit, sentinels: SENTINELS }, type: QueryTypes.SELECT }
    );
}

async function runTweetLookup(args) {
    const tweetIds = (await selectTweets(args)).map(r => r.tweetId);
    console.log(`Tweets selected: ${tweetIds.length}`);
    console.log(`Requests: ${Math.ceil(tweetIds.length / BATCH_SIZE)} | max cost: $${(tweetIds.length * POST_READ_COST).toFixed(2)}`);
    if (!args.apply) return { dryRun: true, tweets: tweetIds.length };

    const outcomes = {};
    let tweetsReturned = 0;

    for (let i = 0; i < tweetIds.length; i += BATCH_SIZE) {
        const batch = tweetIds.slice(i, i + BATCH_SIZE);
        // author_id only: an expansion would add user objects we don't need.
        const data = await xGet('https://api.x.com/2/tweets', { ids: batch.join(','), 'tweet.fields': 'author_id' });

        const rows = new Map();
        for (const tweet of data.data || []) {
            rows.set(tweet.id, { tweetId: tweet.id, authorId: tweet.author_id, source: 'tweet_lookup', status: 'found' });
            tweetsReturned++;
        }
        for (const error of data.errors || []) {
            if (error.parameter !== 'ids' || !error.value || rows.has(error.value)) continue;
            rows.set(error.value, {
                tweetId: error.value, source: 'tweet_lookup', status: statusFromErrorTitle(error.title),
                errorTitle: error.title, errorDetail: error.detail
            });
        }
        for (const tweetId of batch) {
            if (!rows.has(tweetId)) {
                rows.set(tweetId, { tweetId, source: 'tweet_lookup', status: 'error', errorDetail: 'missing from both data and errors in the X response' });
            }
        }

        for (const row of rows.values()) bump(outcomes, row.status);
        await recordTweetAuthors([...rows.values()]);

        console.log(`  tweets batch ${i / BATCH_SIZE + 1}/${Math.ceil(tweetIds.length / BATCH_SIZE)} | found ${tweetsReturned}`);
        if (i + BATCH_SIZE < tweetIds.length) await sleep(DELAY_BETWEEN_BATCHES_MS);
    }

    return { tweets: tweetIds.length, tweetsReturned, cost: tweetsReturned * POST_READ_COST, outcomes };
}

async function backfillTweetAuthors(argv = []) {
    const args = parseArgs(argv);
    await sequelize.authenticate();
    await ensureTweetAuthorsTable();
    console.log(`Mode: ${args.mode} | limit: ${args.limit} | ${args.sample ? 'random sample' : 'stable order'} | ${args.apply ? 'APPLY' : 'DRY RUN'}`);

    const summary = args.mode === 'handles' ? await runHandles(args) : await runTweetLookup(args);
    console.log('\n--- Summary ---');
    console.log(JSON.stringify(summary, null, 2));
    return summary;
}

if (require.main === module) {
    backfillTweetAuthors(process.argv.slice(2))
        .then(() => sequelize.close())
        .catch(async (error) => {
            console.error('\n!!! BACKFILL FAILED !!!');
            console.error(error.message || error);
            await sequelize.close();
            process.exit(1);
        });
}

module.exports = backfillTweetAuthors;
