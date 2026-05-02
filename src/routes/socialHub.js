const express = require('express');
const { protect } = require('../middleware/auth');
const socialHubController = require('../controllers/socialHubController');

const router = express.Router();

router.use(protect);

router.get('/accounts', socialHubController.getConnectedAccounts);
router.post('/publish', socialHubController.publishContent);
router.post('/profile', socialHubController.updateProfile);
router.post('/upload', socialHubController.uploadMedia);
router.get('/feed', socialHubController.getFeed);
router.post('/delete-post', socialHubController.deletePost);

module.exports = router;
