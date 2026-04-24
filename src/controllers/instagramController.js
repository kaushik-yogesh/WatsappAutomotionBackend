const InstagramAccount = require('../models/InstagramAccount');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const axios = require('axios');

exports.connectAccount = async (req, res, next) => {
  try {
    const { igAccountId, pageId, pageAccessToken, igUsername } = req.body;

    if (!igAccountId || !pageId || !pageAccessToken) {
      return next(new AppError('igAccountId, pageId, and pageAccessToken are required', 400));
    }

    // Verify token by making a dummy request to Graph API
    try {
      const apiVersion = process.env.META_API_VERSION || 'v19.0';
      await axios.get(`https://graph.facebook.com/${apiVersion}/${igAccountId}`, {
        params: { access_token: pageAccessToken }
      });
    } catch (err) {
      return next(new AppError('Invalid Access Token or Instagram Account ID', 400));
    }

    const account = await InstagramAccount.findOneAndUpdate(
      { igAccountId },
      {
        user: req.user._id,
        igUsername,
        pageId,
        pageAccessToken,
        status: 'connected',
        isActive: true,
      },
      { new: true, upsert: true }
    );

    res.status(200).json({
      status: 'success',
      message: 'Instagram account connected successfully. Ensure your Meta App Webhook is subscribed to "messages" and "comments" fields for this page.',
      data: { account },
    });
  } catch (err) {
    next(err);
  }
};

exports.getAllAccounts = async (req, res, next) => {
  try {
    const accounts = await InstagramAccount.find({ user: req.user._id }).sort('-createdAt');
    res.status(200).json({
      status: 'success',
      data: { accounts },
    });
  } catch (err) {
    next(err);
  }
};

exports.disconnectAccount = async (req, res, next) => {
  try {
    const account = await InstagramAccount.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!account) return next(new AppError('Account not found', 404));

    res.status(204).json({ status: 'success', data: null });
  } catch (err) {
    next(err);
  }
};
