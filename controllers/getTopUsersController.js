const getTopUsers = require('../services/getTopUsers');

exports.getTopUsers = async (req, res) => {
    try {
      const limit = req.query.limit || 100;  
      const users = await getTopUsers(limit);
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
};
