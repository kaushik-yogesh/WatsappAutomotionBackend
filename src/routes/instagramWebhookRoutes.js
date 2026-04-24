const express = require('express');
const instagramWebhookController = require('../controllers/instagramWebhookController');

const router = express.Router();

router.get('/', instagramWebhookController.verifyWebhook);
router.post('/', instagramWebhookController.receiveMessage);

module.exports = router;
