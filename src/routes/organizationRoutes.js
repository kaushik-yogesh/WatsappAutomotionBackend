const express = require('express');
const organizationController = require('../controllers/organizationController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware.protect);

router.route('/')
  .get(organizationController.getOrganizations)
  .post(organizationController.createOrganization);

router.get('/:organizationId', organizationController.getOrganizationDetails);
router.post('/switch/:organizationId', organizationController.switchOrganization);

module.exports = router;
