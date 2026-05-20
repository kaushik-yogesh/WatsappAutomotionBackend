const express = require('express');
const { protect } = require('../middleware/auth');
const { injectOrganization, requireOrganization } = require('../middleware/organizationMiddleware');
const socialHubController = require('../controllers/socialHubController');

const router = express.Router();

router.use(protect);
router.use(injectOrganization);
router.use(requireOrganization);

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
router.get('/insights', socialHubController.getInsights);
router.get('/linkedin/auth-url', socialHubController.getLinkedInAuthUrl);
router.post('/linkedin/callback', socialHubController.linkedinCallback);
router.delete('/linkedin/:id', socialHubController.disconnectLinkedInAccount);

module.exports = router;
