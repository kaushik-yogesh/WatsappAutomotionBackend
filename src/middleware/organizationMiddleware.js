const Organization = require('../models/Organization');
const User = require('../models/User');
const AppError = require('../utils/AppError');

exports.injectOrganization = async (req, res, next) => {
  try {
    if (!req.user) return next();

    let organizationId = req.headers['x-organization-id'];

    if (!organizationId) {
      organizationId = req.user.currentOrganization;
    }

    if (!organizationId) {
      // Find first organization for user
      const org = await Organization.findOne({ 'members.user': req.user._id, isActive: true });
      if (org) {
        organizationId = org._id;
        // Update user's current organization silently
        await User.findByIdAndUpdate(req.user._id, { currentOrganization: organizationId });
      }
    }

    if (organizationId) {
      const org = await Organization.findOne({
        _id: organizationId,
        'members.user': req.user._id,
        isActive: true
      });

      if (org) {
        req.organization = org;
      } else if (req.headers['x-organization-id']) {
         // If they explicitly requested an ID they don't have access to
         return next(new AppError('Organization not found or access denied', 404));
      }
    }

    next();
  } catch (err) {
    next(err);
  }
};

exports.requireOrganization = (req, res, next) => {
  if (!req.organization) {
    return next(new AppError('Please select or create an organization to continue.', 400));
  }
  next();
};
