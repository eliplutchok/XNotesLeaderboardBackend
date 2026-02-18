const getOneUser = require('../services/getOneUser');

exports.getOneUser = async (req, res) => {
    try {
        // get handle from url
        const handle = req.params.handle;
        const info = await getOneUser(handle);
        res.json(info);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
