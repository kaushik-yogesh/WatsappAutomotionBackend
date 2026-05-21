const express = require('express');
const adminController = require('../controllers/adminController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Public branding settings endpoint (unauthenticated)
router.get('/public-settings', adminController.getPublicSettings);

// All routes below here are restricted to admin
router.use(protect);
router.use(restrictTo('admin'));

router.get('/stats', adminController.getStats);
router.get('/users', adminController.getAllUsers);
router.get('/users/:id', adminController.getUserDetails);
router.patch('/users/:id', adminController.updateUser);
router.post('/users/:id/request-role-change', adminController.requestRoleChange);
router.post('/users/:id/confirm-role-change', adminController.confirmRoleChange);

router.get('/health', adminController.getSystemHealth);
router.get('/settings', adminController.getSystemSettings);
router.patch('/settings', adminController.updateSystemSetting);

router.get('/logs', adminController.getSystemLogs);
router.get('/orphan-media', adminController.getOrphanMedia);
router.delete('/orphan-media', adminController.deleteMedia);

// Deletion Requests
router.get('/deletion-requests', adminController.getDeletionRequests);
router.post('/users/:id/cancel-deletion', adminController.cancelDeletionRequest);

// Admin Signup Requests management
router.get('/signup-requests', adminController.getSignupRequests);
router.post('/signup-requests/:id/send-otp', adminController.sendSignupRequestOTP);
router.post('/signup-requests/:id/approve', adminController.approveSignupRequest);
router.post('/signup-requests/:id/reject', adminController.rejectSignupRequest);

// Administrative Activity Logs (Audit logs)
router.get('/activities', adminController.getAdminActivities);

// Plan Management
router.get('/plans', adminController.getAllPlans);
router.post('/plans', adminController.createPlan);
router.patch('/plans/:id', adminController.updatePlan);
router.delete('/plans/:id', adminController.deletePlan);

// Payments Management
router.get('/payments', adminController.getAllPayments);
router.patch('/payments/:id/status', adminController.updatePaymentStatus);
router.post('/payments/:id/refund', adminController.refundPayment);

module.exports = router;
