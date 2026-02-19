const { sequelize, Note, NoteStatus } = require('../models/AllModels');
const { Op } = require('sequelize');

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

function getCacheKey(limit) {
    return `topHandles:${limit}`;
}

async function getTopHandles(limit = 100) {
    const key = getCacheKey(limit);
    const cached = cache.get(key);

    if (cached && Date.now() < cached.expiry) {
        console.log(`[cache] returning cached topHandles (limit=${limit}), expires in ${Math.round((cached.expiry - Date.now()) / 60000)}m`);
        return cached.data;
    }

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

        const result = topTweetAuthors.map(author => ({
            handle: author.handle,
            noteCount: author.dataValues.noteCount
        }));

        cache.set(key, { data: result, expiry: Date.now() + SIX_HOURS_MS });
        console.log(`[cache] cached topHandles (limit=${limit}) for 6 hours`);

        return result;
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}


module.exports = getTopHandles;