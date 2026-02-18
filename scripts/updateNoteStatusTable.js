const { sequelize, NoteStatus } = require('../models/AllModels');
const fs = require('fs');
const csv = require('csv-parser');

const BATCH_SIZE = 5000;

const updateNoteStatusTable = async (filePath) => {
    try {
        await sequelize.authenticate();
        console.log('Status connection has been established successfully.');

        const fileSize = fs.statSync(filePath).size;
        console.log(`Reading: ${filePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

        await NoteStatus.destroy({ truncate: true });
        console.log('Status table truncated.');

        let statusBatch = [];
        let totalRows = 0;
        const startTime = Date.now();

        const stream = fs.createReadStream(filePath)
            .pipe(csv({ separator: '\t' }));

        for await (const row of stream) {
            statusBatch.push(row);
            totalRows++;

            if (statusBatch.length >= BATCH_SIZE) {
                await NoteStatus.bulkCreate(statusBatch, { returning: false });
                statusBatch = [];
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
                process.stdout.write(`\r  Rows: ${totalRows.toLocaleString()} | Elapsed: ${elapsed}s`);
            }
        }

        if (statusBatch.length) {
            await NoteStatus.bulkCreate(statusBatch, { returning: false });
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`\n  Done: ${totalRows.toLocaleString()} rows in ${elapsed}s`);
        console.log('Status database update complete.');

    } catch (error) {
        console.error('Unable to connect to the status database:', error);
        throw error;
    }
};

module.exports = updateNoteStatusTable;
