const express = require('express');
const router = express.Router();
const dealController = require('../controllers/dealController');
const { protect } = require('../middleware/auth');
const { requireTenant } = require('../middleware/organizationMiddleware');
const { requirePermission } = require('../middleware/permissions');
const { validateBody, schemas } = require('../middleware/validation');

// Use validation schema if available, else omit
router.use(protect);
router.use(requireTenant);

router.route('/')
  .get(requirePermission('contacts:read'), dealController.getDeals)
  .post(requirePermission('contacts:write'), dealController.createDeal);

router.route('/:id')
  .patch(requirePermission('contacts:write'), dealController.updateDeal)
  .delete(requirePermission('contacts:delete'), dealController.deleteDeal);

module.exports = router;
