const { User } = require('../models/AllModels');
const { Op } = require('sequelize');
const getNotesByUser = require('./getNotesByUser');

async function getOneUser(userHandle) {
    try {
        let userInfo = {
            "id": null,
            "bannerPic": "https://i.imgur.com/bAcnNJy.png",
            "bio": null,
            "followers": null,
            "following": null,
            "handle": userHandle,
            "location": null,
            "profilePic": "https://i.imgur.com/UPCc3ko.png",
            "subscriptions": null,
            "username": null,
            "website": null,
            "joined": null,
        };
        const user = await User.findOne({
            where: {
                handle: { [Op.iLike]: userHandle }
            }
        });
        if (user) {
            userInfo = user.dataValues;
        }
       
        const notesInfo = await getNotesByUser(userHandle);
        
        const info = { ...userInfo, ...notesInfo };
        if (notesInfo["notes"].length > 0) {
            info["handle"] = notesInfo["notes"][0]["handle"];
        }
        return info;

    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

module.exports = getOneUser;
