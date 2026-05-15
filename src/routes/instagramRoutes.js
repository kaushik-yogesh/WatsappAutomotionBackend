const express = require('express');
const instagramController = require('../controllers/instagramController');
const { protect } = require('../middleware/auth');
const { injectOrganization, requireOrganization } = require('../middleware/organizationMiddleware');

const router = express.Router();

router.use(protect);
router.use(injectOrganization);
router.use(requireOrganization);

router.post('/connect', instagramController.connectAccount);
router.post('/auto-connect', instagramController.autoConnect);
router.get('/', instagramController.getAllAccounts);
router.delete('/:id', instagramController.disconnectAccount);
router.patch('/:id/bot', instagramController.updateBotSettings);

module.exports = router;
