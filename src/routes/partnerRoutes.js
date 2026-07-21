const express = require('express');
const partnerController = require('../controllers/partnerController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

// Partner routes (Accessible by sales_partner and admin)
router.get('/dashboard', partnerController.getPartnerDashboard);
router.get('/payouts', partnerController.getPartnerPayouts);

// Admin routes (Accessible only by admin / superadmin)
router.use('/admin', restrictTo('admin', 'superadmin'));

router.get('/admin/partners', partnerController.getAllPartners);
router.post('/admin/assign-role', partnerController.assignPartnerRole);
router.get('/admin/settings', partnerController.getAdminSettings);
router.patch('/admin/settings', partnerController.updateAdminSettings);
router.post('/admin/process-payout', partnerController.processPayout);

module.exports = router;
