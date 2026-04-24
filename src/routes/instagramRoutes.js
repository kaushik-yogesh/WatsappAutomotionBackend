const express = require('express');
const instagramController = require('../controllers/instagramController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.post('/connect', instagramController.connectAccount);
router.get('/', instagramController.getAllAccounts);
router.delete('/:id', instagramController.disconnectAccount);

module.exports = router;
