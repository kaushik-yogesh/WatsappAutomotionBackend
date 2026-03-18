const express = require('express');
const router = express.Router();
const waController = require('../controllers/whatsappController');
const webhookController = require('../controllers/webhookController');
const embeddedSignupController = require('../controllers/Embeddedsignupcontroller');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

// Webhook routes (no auth - called by Meta)
router.get('/webhook', webhookController.verifyWebhook);
router.post('/webhook', webhookController.receiveMessage);

// Protected routes
router.use(protect);

// Embedded Signup routes
router.post('/embedded-signup/callback', embeddedSignupController.embeddedSignupCallback);
router.post('/embedded-signup/save', embeddedSignupController.embeddedSignupSave);


router.post('/connect', validate(schemas.connectWhatsapp), waController.connectAccount);
router.get('/', waController.getAccounts);
router.get('/:id', waController.getAccount);
router.post('/:id/verify', waController.verifyConnection);
router.delete('/:id', waController.disconnectAccount);

module.exports = router;
