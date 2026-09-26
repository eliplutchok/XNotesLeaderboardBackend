/**
 * Clears 'not found once' for tweets whose lookup failed because of an API
 * error (e.g. 402 credits depleted) rather than a missing tweet, so the next
 * addHandlesApi.js run looks them up again.
 *
 * The input file has one tweet ID per line, taken from the failed runs' logs.
 * Dry-run by default. Pass --apply to write.
 *
 *   node scripts/resetFailedLookups.js --file=tsv/retry-402-tweetIds.txt
 *   node scripts/resetFailedLookups.js --file=tsv/retry-402-tweetIds.txt --apply
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/AllModels');

const SENTINEL = 'not found once';

function parseArgs(argv) {
    const args = { file: null, apply: false };
    for (const arg of argv) {
        if (arg === '--apply') args.apply = true;
        else if (arg.startsWith('--file=')) args.file = arg.slice('--file='.length);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!args.file) throw new Error('Missing --file=<path to tweet ID list>');
    return args;
}

async function resetFailedLookups(argv = []) {
    const args = parseArgs(argv);

    const tweetIds = [...new Set(
        fs.readFileSync(args.file, 'utf8').split('\n').map(s => s.trim()).filter(s => /^\d+$/.test(s))
    )];
    console.log(`Loaded ${tweetIds.length} tweet IDs from ${args.file}`);
    console.log(args.apply ? 'MODE: APPLY (writes enabled)' : 'MODE: DRY RUN (no writes)');

    await sequelize.authenticate();

    const [{ matched }] = await sequelize.query(
        `SELECT COUNT(*)::int AS matched FROM notes
         WHERE handle = :sentinel AND "tweetId"::text IN (:tweetIds)`,
        { replacements: { sentinel: SENTINEL, tweetIds }, type: QueryTypes.SELECT }
    );
    console.log(`Notes currently marked '${SENTINEL}' for these tweets: ${matched}`);

    if (!args.apply) {
        console.log('Dry run only. Re-run with --apply to reset them to NULL.');
        return matched;
    }

    const [, meta] = await sequelize.query(
        `UPDATE notes SET handle = NULL
         WHERE handle = :sentinel AND "tweetId"::text IN (:tweetIds)`,
        { replacements: { sentinel: SENTINEL, tweetIds } }
    );
    console.log(`Reset ${meta.rowCount} notes to NULL. The next addHandlesApi.js run will retry them.`);
    return meta.rowCount;
}

if (require.main === module) {
    resetFailedLookups(process.argv.slice(2))
        .then(() => sequelize.close())
        .catch(async (error) => {
            console.error(error);
            await sequelize.close();
            process.exit(1);
        });
}

module.exports = resetFailedLookups;
