const { sequelize } = require('../models/AllModels');

const updateNoteTable = async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connection has been established successfully.');

        // Truncate the Note table
        await sequelize.query('TRUNCATE TABLE notes RESTART IDENTITY CASCADE');
        console.log('Note table truncated.');

        // Copy data from NoteBackup to Note
        await sequelize.query('INSERT INTO notes SELECT * FROM notes_backup');
        console.log('Data copied from NoteBackup to Note.');

    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
};

// Execute the update function
// updateNoteTable();

module.exports = updateNoteTable;
