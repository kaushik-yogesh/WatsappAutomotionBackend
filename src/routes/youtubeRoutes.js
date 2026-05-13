const express = require('express');
const youtubeController = require('../controllers/youtubeController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/auth-url', youtubeController.getAuthUrl);
router.post('/callback', youtubeController.callback);
router.post('/disconnect', youtubeController.disconnect);

// Automation Routes
const automationController = require('../controllers/youtubeAutomationController');
router.get('/automation/settings', automationController.getSettings);
router.patch('/automation/settings', automationController.updateSettings);
router.get('/automation/pending', automationController.getPendingComments);
router.get('/automation/history', automationController.getHistory);
router.post('/automation/approve', automationController.approveReply);
router.post('/automation/ignore', automationController.ignoreComment);

module.exports = router;
