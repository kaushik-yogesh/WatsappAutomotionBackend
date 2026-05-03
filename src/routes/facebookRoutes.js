const express = require('express');
const facebookController = require('../controllers/facebookController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.post('/auto-connect', facebookController.autoConnect);
router.get('/accounts', facebookController.getAllAccounts);
router.delete('/accounts/:id', facebookController.disconnectAccount);

module.exports = router;
