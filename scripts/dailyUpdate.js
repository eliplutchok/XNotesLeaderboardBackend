const path = require('path');
const fs = require('fs');
const updateNoteTable = require('./updateNoteTable');
const updateNoteStatusTable = require('./updateNoteStatusTable');
const addHandles = require('./addHandlesApi');
const downloadNewData = require('./downloadNewData');
const updateHandlesFromBackup = require('./updateHandlesFromBackup');
const backupHandles = require('./backupHandles');
const updateNoteBackupTable = require('./updateNoteBackupTable');
const deleteFile = require('./deleteFile');

const tsvFolderPath = path.join(__dirname, '..', 'tsv');
const authorBackupFile = path.join(tsvFolderPath, 'handlesBackup.tsv');

function verifyFilesExist(label, files) {
    console.log(`\nVerifying ${label}...`);
    for (const f of files) {
        if (!fs.existsSync(f)) {
            throw new Error(`SAFETY CHECK FAILED: Expected file not found: ${f}`);
        }
        const stats = fs.statSync(f);
        if (stats.size === 0) {
            throw new Error(`SAFETY CHECK FAILED: File is empty: ${f}`);
        }
        console.log(`  ${path.basename(f)} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
    }
    console.log('All verified.\n');
}

const dailyUpdate = async () => {
    try {
        const { noteFiles, noteStatusFiles } = await downloadNewData(tsvFolderPath);
        verifyFilesExist('downloaded files', [...noteFiles, ...noteStatusFiles]);

        await updateNoteStatusTable(noteStatusFiles);
        await backupHandles(authorBackupFile);
        verifyFilesExist('handle backup', [authorBackupFile]);

        await updateNoteBackupTable(noteFiles);
        await updateHandlesFromBackup(authorBackupFile);
        await updateNoteTable();
        await addHandles(10000);

        for (const f of [...noteFiles, ...noteStatusFiles]) await deleteFile(f);

        console.log('********************* Daily update complete. *********************');
        process.exit(0);
    } catch (error) {
        console.error('\n!!! DAILY UPDATE FAILED !!!');
        console.error(error);
        process.exit(1);
    }
};

dailyUpdate();
module.exports = dailyUpdate;
