const express = require('express');
const fraudAdminController = require('../controllers/fraudAdminController');
// Assuming authMiddleware contains protect and restrictTo
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

// Require admin privileges for all routes here
router.use(protect);
router.use(restrictTo('admin'));

router.get('/analytics', fraudAdminController.getFraudAnalytics);
router.get('/events', fraudAdminController.getSuspiciousEvents);
router.get('/blocked-ips', fraudAdminController.getBlockedIPs);
router.post('/unblock', fraudAdminController.unblockIP);

module.exports = router;
