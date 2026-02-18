const fs = require('fs');
const csv = require('csv-parser');
const { sequelize } = require('../models/AllModels');

const BATCH_SIZE = 5000;

const updateHandlesFromBackup = async (backupFilePath) => {
    const fileSize = fs.statSync(backupFilePath).size;
    console.log(`Restoring handles from: ${backupFilePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

    let batch = [];
    let totalRows = 0;
    let totalUpdated = 0;
    const startTime = Date.now();

    const flushBatch = async () => {
        if (batch.length === 0) return;

        const values = batch
            .map(({ noteId, handle }) => {
                const escapedHandle = handle.replace(/'/g, "''");
                return `(${noteId}, '${escapedHandle}')`;
            })
            .join(',');

        const [, result] = await sequelize.query(`
            UPDATE notes_backup AS nb
            SET handle = v.handle
            FROM (VALUES ${values}) AS v("noteId", handle)
            WHERE nb."noteId" = v."noteId"::bigint
        `);

        totalUpdated += result.rowCount || 0;
        batch = [];
    };

    const stream = fs.createReadStream(backupFilePath)
        .pipe(csv({ separator: '\t' }));

    for await (const row of stream) {
        if (!row.noteId || !row.handle) continue;

        batch.push({ noteId: row.noteId, handle: row.handle });
        totalRows++;

        if (batch.length >= BATCH_SIZE) {
            await flushBatch();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            process.stdout.write(`\r  Rows: ${totalRows.toLocaleString()} | Updated: ${totalUpdated.toLocaleString()} | Elapsed: ${elapsed}s`);
        }
    }

    await flushBatch();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`\n  Done: ${totalRows.toLocaleString()} rows read, ${totalUpdated.toLocaleString()} updated in ${elapsed}s`);
};

module.exports = updateHandlesFromBackup;
