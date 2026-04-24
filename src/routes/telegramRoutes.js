const express = require('express');
const { protect } = require('../middleware/auth');
const telegramController = require('../controllers/telegramController');

const router = express.Router();

router.use(protect);

router.post('/connect', telegramController.connectAccount);
router.get('/', telegramController.getAccounts);
router.delete('/:id', telegramController.disconnectAccount);

module.exports = router;
