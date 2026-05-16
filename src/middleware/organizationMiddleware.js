const Organization = require('../models/Organization');
const User = require('../models/User');
const AppError = require('../utils/AppError');

exports.injectOrganization = async (req, res, next) => {
  try {
    if (!req.user) return next();

    // Priority 1: explicit header from frontend
    let organizationId = req.headers['x-organization-id'];

    // Priority 2: user's saved current organization from DB
    if (!organizationId && req.user.currentOrganization) {
      organizationId = req.user.currentOrganization;
    }

    // Priority 3: fallback — find any org user belongs to
    if (!organizationId) {
      const org = await Organization.findOne({ 'members.user': req.user._id, isActive: true });
      if (org) {
        organizationId = org._id;
        // Save this as user's current org so next request won't need this lookup
        User.findByIdAndUpdate(req.user._id, { currentOrganization: organizationId }).exec();
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
        // Explicitly requested an org they don't have access to
        return next(new AppError('Organization not found or access denied', 404));
      } else {
        // The saved org is no longer valid — find a valid one
        const fallbackOrg = await Organization.findOne({ 'members.user': req.user._id, isActive: true });
        if (fallbackOrg) {
          req.organization = fallbackOrg;
          User.findByIdAndUpdate(req.user._id, { currentOrganization: fallbackOrg._id }).exec();
        }
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
