const { User } = require('../models/AllModels');
const getTopHandles = require('./getTopHandles');

async function getTopUsers(limit) {
    try {
      const authorData = await getTopHandles(limit);

      const handles = authorData.map(author => author.handle);
  
      if (handles.length > 0) {
        const users = await User.findAll({
          where: { handle: handles }
        });
  
        const userMap = new Map(users.map(user => [user.handle, user.dataValues]));
  
        const mergedData = authorData.map(author => {
          return { ...author, ...userMap.get(author.handle) || {} };
        });

        mergedData.sort((a, b) => b.noteCount - a.noteCount);
        mergedData.forEach((author, index) => {
          author.rank = index + 1;
        });

        return mergedData;
      } else {
        return [];
      }
    } catch (error) {
      console.error('Error fetching user details:', error);
      throw error;
    }
  }
  
module.exports = getTopUsers;
