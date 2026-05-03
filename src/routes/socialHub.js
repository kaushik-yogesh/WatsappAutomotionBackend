const express = require('express');
const { protect } = require('../middleware/auth');
const socialHubController = require('../controllers/socialHubController');

const router = express.Router();

router.use(protect);

router.get('/accounts', socialHubController.getConnectedAccounts);
router.post('/validate', socialHubController.validatePost);
router.post('/format-preview', socialHubController.formatPreview);
router.post('/publish', socialHubController.publishContent);
router.get('/history', socialHubController.getPublishingHistory);
router.get('/analytics', socialHubController.getPublishingAnalytics);
router.post('/retry', socialHubController.retryFailedPlatform);
router.post('/profile', socialHubController.updateProfile);
router.post('/upload', socialHubController.uploadMedia);
router.get('/feed', socialHubController.getFeed);
router.patch('/update-job/:jobId', socialHubController.updateScheduledJob);
router.post('/delete-post', socialHubController.deletePost);

module.exports = router;
