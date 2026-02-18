const { Note, NoteStatus } = require('../models/AllModels');
const { Op } = require('sequelize');

async function getNotesByContent(keywords, search = 'broadest', limit = 500) {
    try {
        let searchCondition;

        if (search === 'narrow') {
            const regexPattern = '(^|\\W)' + keywords.join('|') + '(\\W|$)';
            searchCondition = {
                [Op.iRegexp]: regexPattern
            };
        } else if (search === 'broad') {
            searchCondition = {
                [Op.iLike]: '%' + keywords.join(' ') + '%'
            };
        } else if (search === 'broader') {
            searchCondition = {
                [Op.and]: keywords.map(keyword => ({
                    [Op.iRegexp]: '(^|\\W)' + keyword + '(\\W|$)'
                }))
            };
        } else if (search === 'broadest') {
            searchCondition = {
                [Op.and]: keywords.map(keyword => ({
                    [Op.iLike]: '%' + keyword + '%'
                }))
            };
        }

        const notes = await Note.findAll({
            where: {
                handle: {
                    [Op.ne]: 'not found'
                },
                summary: searchCondition
            },
            include: [{
                model: NoteStatus,
                where: { 
                    currentStatus: 'CURRENTLY_RATED_HELPFUL',
                }
            }],
            order: [['createdAtMillis', 'DESC']],
            limit: limit
        });

        const latestNotes = {};
        notes.forEach(note => {
            if (!latestNotes[note.tweetId] || latestNotes[note.tweetId].createdAtMillis < note.createdAtMillis) {
                latestNotes[note.tweetId] = note;
            }
        });

        const uniqueNotes = Object.values(latestNotes);
        uniqueNotes.sort((a, b) => b.createdAtMillis - a.createdAtMillis);

        const info = { notesCount: uniqueNotes.length };
        info["notes"] = uniqueNotes.map(note => ({
            handle: note.handle,
            noteSummary: note.summary,
            tweetId: note.tweetId,
            createdDate: note.createdAtMillis,
            noteId: note.noteId,
            noteAuthorParticipantId: note.noteAuthorParticipantId,
            classification: note.classification,
            believable: note.believable,
            harmful: note.harmful,
            validationDifficulty: note.validationDifficulty,
            misleadingOther: note.misleadingOther,
            misleadingFactualError: note.misleadingFactualError,
            misleadingManipulatedMedia: note.misleadingManipulatedMedia,
            misleadingOutdatedInformation: note.misleadingOutdatedInformation,
            misleadingMissingImportantContext: note.misleadingMissingImportantContext,
            misleadingUnverifiedClaimAsFact: note.misleadingUnverifiedClaimAsFact,
            misleadingSatire: note.misleadingSatire,
            trustworthySources: note.trustworthySources
        }));

        return info;

    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

module.exports = getNotesByContent;
