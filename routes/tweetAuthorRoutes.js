const express = require('express');
const router = express.Router();
const getTopUsersController = require('../controllers/getTopUsersController');
const getOneUserController = require('../controllers/getOneUserController');
const getNotesByContentController = require('../controllers/getNotesByContentController');

router.get('/top-users', getTopUsersController.getTopUsers);
router.get('/user/:handle', getOneUserController.getOneUser);
router.get('/notes', getNotesByContentController.getNotesByContent);

module.exports = router;
