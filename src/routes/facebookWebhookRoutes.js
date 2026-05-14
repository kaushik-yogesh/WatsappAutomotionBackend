const express = require('express');
const facebookWebhookController = require('../controllers/facebookWebhookController');

const router = express.Router();

router.get('/', facebookWebhookController.verifyWebhook);
router.post('/', facebookWebhookController.receiveMessage);

module.exports = router;
