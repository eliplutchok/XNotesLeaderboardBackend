/**
 * tweet_authors: one row per noted tweet with the X user ID of its author and
 * the outcome of the latest lookup. Unlike `notes`, this table is never
 * truncated by the daily update, so IDs survive the nightly reload.
 *
 *   source  how authorId was obtained: tweet_lookup | handle_lookup |
 *           reply_lookup | partner
 *   status  outcome of the latest check: found | not_found | unauthorized |
 *           handle_reassigned | error
 *
 * X IDs exceed Number.MAX_SAFE_INTEGER, so they are always handled as strings.
 */

const { sequelize } = require('../models/AllModels');

const CREATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tweet_authors (
        "tweetId"         BIGINT PRIMARY KEY,
        "authorId"        BIGINT,
        handle            TEXT,
        "authorCreatedAt" TIMESTAMPTZ,
        source            TEXT NOT NULL,
        status            TEXT NOT NULL,
        "errorTitle"      TEXT,
        "errorDetail"     TEXT,
        "firstLookedUpAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "lastLookedUpAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS tweet_authors_author_id_idx ON tweet_authors ("authorId");
`;

// A known author is never erased by a later failed lookup, and an indirect
// lookup (handle, reply) never overrides an author found from the tweet itself.
const UPSERT_SQL = `
    INSERT INTO tweet_authors
        ("tweetId", "authorId", handle, "authorCreatedAt", source, status, "errorTitle", "errorDetail")
    SELECT * FROM unnest(
        $1::bigint[], $2::bigint[], $3::text[], $4::timestamptz[],
        $5::text[], $6::text[], $7::text[], $8::text[]
    )
    ON CONFLICT ("tweetId") DO UPDATE SET
        "authorId"        = COALESCE(EXCLUDED."authorId", tweet_authors."authorId"),
        handle            = CASE WHEN EXCLUDED."authorId" IS NOT NULL THEN EXCLUDED.handle ELSE tweet_authors.handle END,
        "authorCreatedAt" = CASE WHEN EXCLUDED."authorId" IS NOT NULL THEN EXCLUDED."authorCreatedAt" ELSE tweet_authors."authorCreatedAt" END,
        source            = CASE WHEN EXCLUDED."authorId" IS NOT NULL THEN EXCLUDED.source ELSE tweet_authors.source END,
        status            = EXCLUDED.status,
        "errorTitle"      = EXCLUDED."errorTitle",
        "errorDetail"     = EXCLUDED."errorDetail",
        "lastLookedUpAt"  = now()
    WHERE EXCLUDED.source = 'tweet_lookup'
       OR tweet_authors.source <> 'tweet_lookup'
       OR tweet_authors."authorId" IS NULL
`;

async function ensureTweetAuthorsTable() {
    await sequelize.query(CREATE_TABLE_SQL);
}

/**
 * rows: [{ tweetId, authorId, handle, authorCreatedAt, source, status, errorTitle, errorDetail }]
 * tweetIds must be unique within one call.
 */
async function recordTweetAuthors(rows) {
    if (rows.length === 0) return;
    const col = key => rows.map(r => (r[key] === undefined ? null : r[key]));
    await sequelize.query(UPSERT_SQL, {
        bind: [
            col('tweetId'), col('authorId'), col('handle'), col('authorCreatedAt'),
            col('source'), col('status'), col('errorTitle'), col('errorDetail')
        ]
    });
}

/** Maps an X API error title to a tweet_authors status. */
function statusFromErrorTitle(title = '') {
    if (/not found/i.test(title)) return 'not_found';
    if (/authorization|forbidden/i.test(title)) return 'unauthorized';
    return 'error';
}

/** Creation time encoded in a snowflake tweet ID. */
function tweetCreatedAt(tweetId) {
    return new Date(Number((BigInt(tweetId) >> 22n) + 1288834974657n));
}

module.exports = {
    ensureTweetAuthorsTable,
    recordTweetAuthors,
    statusFromErrorTitle,
    tweetCreatedAt,
};

if (require.main === module) {
    ensureTweetAuthorsTable()
        .then(() => console.log('tweet_authors table is ready'))
        .then(() => sequelize.close())
        .catch(async (error) => {
            console.error(error);
            await sequelize.close();
            process.exit(1);
        });
}
