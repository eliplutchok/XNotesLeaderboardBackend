const { sequelize, NoteBackup } = require('../models/AllModels');
const fs = require('fs');
const csv = require('csv-parser');

const BATCH_SIZE = 10000;

const processFile = async (filePath) => {
    const fileSize = fs.statSync(filePath).size;
    console.log(`  Reading: ${filePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

    let notesBatch = [];
    let totalRows = 0;
    const startTime = Date.now();

    const stream = fs.createReadStream(filePath)
        .pipe(csv({ separator: '\t' }));

    for await (const row of stream) {
        notesBatch.push(row);
        totalRows++;

        if (notesBatch.length >= BATCH_SIZE) {
            await NoteBackup.bulkCreate(notesBatch, { returning: false });
            notesBatch = [];
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            process.stdout.write(`\r  Rows: ${totalRows.toLocaleString()} | Elapsed: ${elapsed}s`);
        }
    }

    if (notesBatch.length) {
        await NoteBackup.bulkCreate(notesBatch, { returning: false });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`\n  Done: ${totalRows.toLocaleString()} rows in ${elapsed}s`);
};

const updateNoteBackupTable = async (filePaths) => {
    if (!Array.isArray(filePaths)) filePaths = [filePaths];

    try {
        await sequelize.authenticate();
        console.log('NoteBackup connection has been established successfully.');

        await NoteBackup.destroy({ truncate: true });
        console.log('NoteBackup table truncated.');

        for (let i = 0; i < filePaths.length; i++) {
            console.log(`Processing file ${i + 1}/${filePaths.length}:`);
            await processFile(filePaths[i]);
        }

        console.log('NoteBackup database update complete.');

    } catch (error) {
        console.error('Unable to connect to the NoteBackup database:', error);
        throw error;
    }
};

module.exports = updateNoteBackupTable;
