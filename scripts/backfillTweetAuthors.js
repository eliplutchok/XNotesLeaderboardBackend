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
 *   --mode=replies  For currently-helpful tweets we never got a handle for and
 *                   that are still unavailable,
 *                   find a direct reply via full-archive search and take its
 *                   in_reply_to_user_id as the author, then resolve the
 *                   author's current handle (GET /2/users). Only rows already
 *                   rechecked (status not_found/unauthorized) are eligible.
 *
 *   --limit=N       Handles (handles mode) or tweets (other modes) to process.
 *   --sample        Pick at random instead of in a stable order, for estimates.
 *   --windows=1,10  Replies mode: search windows in minutes after the tweet,
 *                   tried in order before an unbounded search.
 *   --use-counts    Replies mode: locate the first reply minute with the
 *                   counts endpoint and search only that minute.
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
const COUNTS_ALL_COST = 0.010; // billed per request
const SENTINELS = ['not found once', 'not found twice', 'not found', 'not found thrice'];

function parseArgs(argv) {
    const args = { mode: null, limit: 1000, sample: false, apply: false, windows: DEFAULT_REPLY_WINDOWS_MIN };
    for (const arg of argv) {
        if (arg === '--apply') args.apply = true;
        else if (arg === '--sample') args.sample = true;
        else if (arg === '--use-counts') args.useCounts = true;
        else if (arg.startsWith('--windows=')) {
            args.windows = arg.slice('--windows='.length).split(',').map(Number);
            if (args.windows.some(m => !(m > 0))) throw new Error(`Invalid ${arg} (minutes, e.g. 1,10,1440)`);
        }
        else if (arg.startsWith('--mode=')) args.mode = arg.slice('--mode='.length);
        else if (arg.startsWith('--limit=')) {
            args.limit = parseInt(arg.slice('--limit='.length), 10);
            if (!Number.isInteger(args.limit) || args.limit <= 0) throw new Error(`Invalid ${arg}`);
        } else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!['handles', 'recover', 'recheck', 'replies'].includes(args.mode)) {
        throw new Error('Pass --mode=handles, --mode=recover, --mode=recheck or --mode=replies');
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
            if ((status >= 500 || !error.response) && attempt < 5) {
                const waitMs = 5000 * 2 ** (attempt - 1);
                console.log(`  ${status || error.code} from X, retrying in ${waitMs / 1000}s...`);
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

// --------------------------------------------------------------- replies mode

// Full-archive search allows 300 requests per 15 minutes.
const SEARCH_DELAY_MS = 3100;
const REPLY_MARKER = 'reply search:';
// Narrow windows first: every returned post is billed and a request returns
// at least 10 when available, but an empty window costs nothing.
const DEFAULT_REPLY_WINDOWS_MIN = [1, 10, 1440];
const MAX_COUNTED_MINUTES = 3;

async function selectUnavailableTweets({ limit, sample }) {
    return sequelize.query(
        `SELECT ta."tweetId"::text AS "tweetId", ta.status, ta."errorTitle", ta."errorDetail"
         FROM tweet_authors ta
         WHERE ta."authorId" IS NULL
           AND ta.status IN ('not_found', 'unauthorized')
           AND COALESCE(ta."errorDetail", '') NOT LIKE :marker
           AND EXISTS (
               SELECT 1 FROM notes n JOIN note_status s ON s."noteId" = n."noteId"
               WHERE n."tweetId" = ta."tweetId" AND s."currentStatus" = 'CURRENTLY_RATED_HELPFUL'
           )
           AND NOT EXISTS (
               SELECT 1 FROM notes n WHERE n."tweetId" = ta."tweetId" AND n.handle LIKE '@%'
           )
         ORDER BY ${sample ? 'random()' : 'ta."tweetId"'} LIMIT :limit`,
        { replacements: { limit, marker: `%${REPLY_MARKER}%` }, type: QueryTypes.SELECT }
    );
}

async function findAuthorFromReplies(tweetId, windowsMin) {
    const start = tweetCreatedAt(tweetId);
    let postsReturned = 0;
    let requests = 0;

    for (const windowMs of [...windowsMin.map(m => m * 60 * 1000), null]) {
        const params = {
            query: `in_reply_to_tweet_id:${tweetId}`,
            start_time: start.toISOString(),
            max_results: 10,
            'tweet.fields': 'in_reply_to_user_id'
        };
        if (windowMs !== null) {
            const end = new Date(Math.min(start.getTime() + windowMs, Date.now() - 60 * 1000));
            if (end <= start) continue;
            params.end_time = end.toISOString();
        }

        const data = await xGet('https://api.x.com/2/tweets/search/all', params);
        requests++;
        const replies = data.data || [];
        postsReturned += replies.length;
        await sleep(SEARCH_DELAY_MS);

        const authorIds = [...new Set(replies.map(r => r.in_reply_to_user_id).filter(Boolean))];
        if (authorIds.length === 1) return { authorId: authorIds[0], postsReturned, requests, window: windowMs };
        if (authorIds.length > 1) return { conflict: authorIds, postsReturned, requests };
    }
    return { authorId: null, postsReturned, requests };
}

/**
 * Cheaper variant: one counts request finds the first minute with a reply in
 * the day after the tweet, then only that minute is searched, so usually just
 * one or two posts are billed instead of ten.
 */
async function findAuthorViaCounts(tweetId) {
    const start = tweetCreatedAt(tweetId);
    const end = new Date(Math.min(start.getTime() + 24 * 60 * 60 * 1000, Date.now() - 60 * 1000));
    const query = `in_reply_to_tweet_id:${tweetId}`;
    const counts = await xGet('https://api.x.com/2/tweets/counts/all', {
        query, start_time: start.toISOString(), end_time: end.toISOString(), granularity: 'minute'
    });
    await sleep(SEARCH_DELAY_MS);
    const buckets = (counts.data || [])
        .filter(b => b.tweet_count > 0)
        .sort((a, b) => a.start.localeCompare(b.start));

    // Counts include replies that search won't return (hidden or not yet
    // indexed), so a counted minute can come back empty. Empty searches are
    // free, so try a few counted minutes before paying for a wider window.
    const attempts = buckets.slice(0, MAX_COUNTED_MINUTES).map(b => ({ start: b.start, end: b.end, label: 'counted minute' }));
    attempts.push(buckets.length
        ? { start: start.toISOString(), end: end.toISOString(), label: 'first day' }
        : { start: start.toISOString(), end: null, label: 'any time' });

    let postsReturned = 0;
    let requests = 0;
    for (const attempt of attempts) {
        const params = { query, start_time: attempt.start, max_results: 10, 'tweet.fields': 'in_reply_to_user_id' };
        if (attempt.end) params.end_time = attempt.end;
        const data = await xGet('https://api.x.com/2/tweets/search/all', params);
        requests++;
        await sleep(SEARCH_DELAY_MS);

        const replies = data.data || [];
        postsReturned += replies.length;
        const authorIds = [...new Set(replies.map(r => r.in_reply_to_user_id).filter(Boolean))];
        const base = { postsReturned, requests, countRequests: 1, window: attempt.label };
        if (authorIds.length === 1) return { ...base, authorId: authorIds[0] };
        if (authorIds.length > 1) return { ...base, conflict: authorIds };
    }
    return { postsReturned, requests, countRequests: 1, authorId: null };
}

async function lookupUsersById(userIds) {
    const users = new Map();
    const failures = new Map();
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const data = await xGet('https://api.x.com/2/users', {
            ids: userIds.slice(i, i + BATCH_SIZE).join(','),
            'user.fields': 'created_at'
        });
        for (const user of data.data || []) users.set(user.id, user);
        for (const error of data.errors || []) {
            if (error.value) failures.set(String(error.value), { status: statusFromErrorTitle(error.title), title: error.title, detail: error.detail });
        }
        if (i + BATCH_SIZE < userIds.length) await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
    return { users, failures };
}

async function runReplies(args) {
    const tweets = await selectUnavailableTweets(args);
    console.log(`Tweets selected: ${tweets.length}`);
    console.log(`Max cost: $${(tweets.length * 10 * POST_READ_COST + tweets.length * USER_READ_COST).toFixed(2)} (10 replies + 1 user each) | ~${Math.ceil(tweets.length * 1.5 * SEARCH_DELAY_MS / 60000)} min`);
    if (!args.apply) return { dryRun: true, tweets: tweets.length };

    const found = new Map(); // tweetId -> authorId
    const stats = { strategy: args.useCounts ? 'counts' : `windows ${args.windows.join(',')}`, tweets: tweets.length, requests: 0, countRequests: 0, postsReturned: 0, authorFound: 0, noReplies: 0, conflicts: 0, foundInWindow: {} };

    for (const [index, tweet] of tweets.entries()) {
        const result = args.useCounts
            ? await findAuthorViaCounts(tweet.tweetId)
            : await findAuthorFromReplies(tweet.tweetId, args.windows);
        stats.requests += result.requests;
        stats.countRequests += result.countRequests || 0;
        stats.postsReturned += result.postsReturned;

        let note;
        if (result.authorId) {
            found.set(tweet.tweetId, result.authorId);
            stats.authorFound++;
            const label = typeof result.window === 'string' ? result.window
                : result.window === null ? 'any time' : `${result.window / 60000} min`;
            bump(stats.foundInWindow, label);
            // Saved now so an aborted run keeps what it paid for; the handle
            // is filled in by the user lookup at the end.
            await recordTweetAuthors([{
                tweetId: tweet.tweetId, authorId: result.authorId, source: 'reply_lookup', status: tweet.status,
                errorTitle: tweet.errorTitle,
                errorDetail: [tweet.errorDetail, `${REPLY_MARKER} author from in_reply_to_user_id`].filter(Boolean).join(' | ')
            }]);
            continue;
        } else if (result.conflict) {
            stats.conflicts++;
            note = `${REPLY_MARKER} replies disagree on author (${result.conflict.join(', ')})`;
        } else {
            stats.noReplies++;
            note = `${REPLY_MARKER} no replies found`;
        }

        await recordTweetAuthors([{
            tweetId: tweet.tweetId, source: 'reply_lookup', status: tweet.status,
            errorTitle: tweet.errorTitle, errorDetail: [tweet.errorDetail, note].filter(Boolean).join(' | ')
        }]);

        if ((index + 1) % 25 === 0) console.log(`  ${index + 1}/${tweets.length} | authors ${stats.authorFound} | posts billed ${stats.postsReturned}`);
    }

    // Includes authors found by earlier runs that stopped before this step.
    const pending = await sequelize.query(
        `SELECT "tweetId"::text AS "tweetId", "authorId"::text AS "authorId", status, "errorTitle", "errorDetail"
         FROM tweet_authors WHERE source = 'reply_lookup' AND "authorId" IS NOT NULL AND handle IS NULL`,
        { type: QueryTypes.SELECT }
    );
    const { users, failures } = await lookupUsersById([...new Set(pending.map(p => p.authorId))]);

    const rows = pending
        .filter(p => users.has(p.authorId))
        .map(p => {
            const user = users.get(p.authorId);
            return {
                tweetId: p.tweetId, authorId: p.authorId, handle: `@${user.username}`, authorCreatedAt: user.created_at,
                source: 'reply_lookup', status: p.status, errorTitle: p.errorTitle, errorDetail: p.errorDetail
            };
        });
    await recordTweetAuthors(rows);

    const authorIds = [...new Set(found.values())];
    stats.distinctAuthors = authorIds.length;
    stats.authorsWithHandle = authorIds.filter(id => users.has(id)).length;
    stats.authorAccountStatus = {};
    for (const id of authorIds) bump(stats.authorAccountStatus, users.has(id) ? 'active' : (failures.get(id)?.status || 'missing'));
    stats.tweetsWithHandle = [...found.values()].filter(id => users.has(id)).length;
    stats.cost = +(stats.postsReturned * POST_READ_COST + users.size * USER_READ_COST + stats.countRequests * COUNTS_ALL_COST).toFixed(2);
    stats.costPerTweet = +(stats.cost / tweets.length).toFixed(4);
    return stats;
}

async function backfillTweetAuthors(argv = []) {
    const args = parseArgs(argv);
    await sequelize.authenticate();
    await ensureTweetAuthorsTable();
    console.log(`Mode: ${args.mode} | limit: ${args.limit} | ${args.sample ? 'random sample' : 'stable order'} | ${args.apply ? 'APPLY' : 'DRY RUN'}`);

    const summary = args.mode === 'handles' ? await runHandles(args)
        : args.mode === 'replies' ? await runReplies(args)
        : await runTweetLookup(args);
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
module.exports.findAuthorViaCounts = findAuthorViaCounts;
module.exports.findAuthorFromReplies = findAuthorFromReplies;
