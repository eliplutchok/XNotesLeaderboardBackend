const { sequelize, Note, NoteStatus } = require('../models/AllModels');
const { Op } = require('sequelize');

async function getTopHandles(limit = 100) {
    try {
        const topTweetAuthors = await Note.findAll({
            where: {
                handle: {
                    [Op.notIn]: ['not found once', 'not found twice', 'not found', 'not found thrice']
                }
            },
            attributes: ['handle', [sequelize.fn('COUNT', sequelize.col('Note.handle')), 'noteCount']],
            include: [{
                model: NoteStatus,
                attributes: [],
                where: { 
                    currentStatus: 'CURRENTLY_RATED_HELPFUL',
                }
            }],
            group: ['Note.handle'],
            order: [[sequelize.fn('COUNT', sequelize.col('Note.handle')), 'DESC']],
            limit: limit
        });

        return topTweetAuthors.map(author => ({
            handle: author.handle,
            noteCount: author.dataValues.noteCount
          }));

    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

module.exports = getTopHandles;
