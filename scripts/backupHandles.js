const { Note} = require('../models/AllModels');
const fs = require('fs');
const stringify = require('csv-stringify').stringify;
const { Op } = require('sequelize');

const backupHandles = async (fileName) => {
    return new Promise(async (resolve, reject) => {
        try {
            const notes = await Note.findAll({
                attributes: ['noteId', 'handle'],
                where: { handle: { [Op.ne]: null } }
            });

            if (notes.length === 0) {
                console.log('No notes data found for backup.');
                resolve(); // Resolve without writing a file
                return;
            }

            const writableStream = fs.createWriteStream(fileName);
            const stringifier = stringify({ header: true, delimiter: '\t' });

            stringifier.pipe(writableStream);

            notes.forEach((note) => {
                stringifier.write({ noteId: note.noteId, handle: note.handle });
            });

            stringifier.end();

            writableStream.on('finish', () => {
                console.log('Backup of handle data complete.');
                resolve(); // Resolve when file is done writing
            });

            writableStream.on('error', (error) => {
                console.error('Error writing backup file:', error);
                reject(error);
            });
        } catch (error) {
            console.error('Error during handle backup:', error);
            reject(error);
        }
    });
};

// const authorBackupFile = '../tsv/handlesBackup.tsv';
// backupHandles(authorBackupFile);

module.exports = backupHandles;