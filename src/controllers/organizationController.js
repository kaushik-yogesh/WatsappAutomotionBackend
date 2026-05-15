const Organization = require('../models/Organization');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

exports.createOrganization = async (req, res, next) => {
  try {
    const { name } = req.body;
    
    const organization = await Organization.create({
      name,
      owner: req.user._id,
      members: [{ user: req.user._id, role: 'admin' }]
    });

    // Set as current organization
    await User.findByIdAndUpdate(req.user._id, { currentOrganization: organization._id });

    res.status(201).json({
      status: 'success',
      data: { organization }
    });
  } catch (err) {
    logger.error('Create Organization Error:', err);
    next(err);
  }
};

exports.getOrganizations = async (req, res, next) => {
  try {
    const organizations = await Organization.find({
      'members.user': req.user._id,
      isActive: true
    });

    res.status(200).json({
      status: 'success',
      results: organizations.length,
      data: { organizations }
    });
  } catch (err) {
    next(err);
  }
};

exports.switchOrganization = async (req, res, next) => {
  try {
    const { organizationId } = req.params;

    // Check if user is member of this organization
    const org = await Organization.findOne({
      _id: organizationId,
      'members.user': req.user._id,
      isActive: true
    });

    if (!org) {
      return next(new AppError('Organization not found or access denied', 404));
    }

    await User.findByIdAndUpdate(req.user._id, { currentOrganization: organizationId });

    res.status(200).json({
      status: 'success',
      message: 'Switched organization successfully',
      data: { organization: org }
    });
  } catch (err) {
    next(err);
  }
};

exports.getOrganizationDetails = async (req, res, next) => {
  try {
    const { organizationId } = req.params;
    const org = await Organization.findOne({
      _id: organizationId,
      'members.user': req.user._id
    }).populate('members.user', 'name email');

    if (!org) {
      return next(new AppError('Organization not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { organization: org }
    });
  } catch (err) {
    next(err);
  }
};
