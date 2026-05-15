const express = require('express');
const facebookController = require('../controllers/facebookController');
const { protect } = require('../middleware/auth');
const { injectOrganization, requireOrganization } = require('../middleware/organizationMiddleware');

const router = express.Router();

router.use(protect);
router.use(injectOrganization);
router.use(requireOrganization);

router.post('/auto-connect', facebookController.autoConnect);
router.get('/accounts', facebookController.getAllAccounts);
router.patch('/accounts/:id/bot', facebookController.updateBotSettings);
router.delete('/accounts/:id', facebookController.disconnectAccount);

module.exports = router;
