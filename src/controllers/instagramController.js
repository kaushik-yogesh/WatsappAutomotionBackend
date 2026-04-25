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

exports.autoConnect = async (req, res, next) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) return next(new AppError('Facebook access token is required', 400));

    const apiVersion = process.env.META_API_VERSION || 'v19.0';
    
    // 1. Get Facebook Pages
    const pagesResponse = await axios.get(`https://graph.facebook.com/${apiVersion}/me/accounts`, {
      params: { access_token: accessToken }
    });

    const pages = pagesResponse.data.data;
    if (!pages || pages.length === 0) {
      return next(new AppError('No Facebook Pages found for this account', 404));
    }

    const connectedAccounts = [];

    // 2. For each page, check for Instagram Business Account
    for (const page of pages) {
      try {
        const pageDetails = await axios.get(`https://graph.facebook.com/${apiVersion}/${page.id}`, {
          params: { 
            fields: 'instagram_business_account,name',
            access_token: page.access_token 
          }
        });

        const igBusinessAccount = pageDetails.data.instagram_business_account;

        if (igBusinessAccount) {
          const igAccountId = igBusinessAccount.id;
          
          // 3. Get IG Username
          let igUsername = page.name || 'Instagram Account';
          try {
            const igDetails = await axios.get(`https://graph.facebook.com/${apiVersion}/${igAccountId}`, {
              params: {
                fields: 'username',
                access_token: page.access_token
              }
            });
            if (igDetails.data.username) {
              igUsername = igDetails.data.username;
            }
          } catch (err) {
            logger.warn(`Could not fetch username for IG Account ${igAccountId}`);
          }

          // Save to DB
          const account = await InstagramAccount.findOneAndUpdate(
            { igAccountId },
            {
              user: req.user._id,
              igUsername,
              pageId: page.id,
              pageAccessToken: page.access_token,
              status: 'connected',
              isActive: true,
            },
            { new: true, upsert: true }
          );
          
          connectedAccounts.push(account);
        }
      } catch (err) {
        logger.error(`Error processing page ${page.id}: ${err.message}`);
      }
    }

    if (connectedAccounts.length === 0) {
      return next(new AppError('No connected Instagram Professional Accounts found on your Facebook Pages. Please link your Instagram account to a Facebook page first.', 404));
    }

    res.status(200).json({
      status: 'success',
      message: `Successfully connected ${connectedAccounts.length} Instagram account(s).`,
      data: { accounts: connectedAccounts },
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
