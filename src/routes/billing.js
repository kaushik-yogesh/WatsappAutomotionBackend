const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billingController');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

router.use(protect);
router.get('/plans', billingController.getPlans);
router.post('/create-order', validate(schemas.createOrder), billingController.createOrder);
router.post('/verify-payment', validate(schemas.verifyPayment), billingController.verifyPayment);
router.get('/history', billingController.getBillingHistory);
router.delete('/cancel', billingController.cancelSubscription);

module.exports = router;
