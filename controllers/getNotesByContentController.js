const getNotesByContent = require('../services/getNotesByContent');

exports.getNotesByContent = async (req, res) => {
    try {
        const keywords = req.query.keywords;
        const search = req.query.search;

        if (!keywords) {
            return res.status(400).json({ error: 'No keywords provided' });
        }

        const keywordArray = keywords.split(' ');

        const info = await getNotesByContent(keywordArray, search);
        res.json(info);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
