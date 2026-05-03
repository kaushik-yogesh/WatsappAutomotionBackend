const FacebookAccount = require('../models/FacebookAccount');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const axios = require('axios');

exports.autoConnect = async (req, res, next) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) return next(new AppError('Facebook access token is required', 400));

    const apiVersion = process.env.META_API_VERSION || 'v19.0';
    let finalUserToken = accessToken;

    if (process.env.META_APP_ID && process.env.META_APP_SECRET) {
      try {
        const tokenExchangeRes = await axios.get(`https://graph.facebook.com/${apiVersion}/oauth/access_token`, {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: process.env.META_APP_ID,
            client_secret: process.env.META_APP_SECRET,
            fb_exchange_token: accessToken,
          }
        });
        if (tokenExchangeRes.data && tokenExchangeRes.data.access_token) {
          finalUserToken = tokenExchangeRes.data.access_token;
        }
      } catch (err) {
        logger.warn(`Failed to get long-lived token: ${err.message}`);
      }
    }
    
    const pagesResponse = await axios.get(`https://graph.facebook.com/${apiVersion}/me/accounts`, {
      params: { access_token: finalUserToken }
    });

    const pages = pagesResponse.data.data;
    if (!pages || pages.length === 0) {
      return next(new AppError('No Facebook Pages found for this account', 404));
    }

    const connectedAccounts = [];

    for (const page of pages) {
      try {
        const account = await FacebookAccount.findOneAndUpdate(
          { pageId: page.id },
          {
            user: req.user._id,
            pageName: page.name || 'Facebook Page',
            pageAccessToken: page.access_token,
            status: 'connected',
            isActive: true,
          },
          { new: true, upsert: true }
        );
        
        connectedAccounts.push(account);

        try {
          await axios.post(`https://graph.facebook.com/${apiVersion}/${page.id}/subscribed_apps`, null, {
            params: {
              subscribed_fields: 'messages,messaging_postbacks,feed',
              access_token: page.access_token
            }
          });
        } catch (err) {
          logger.warn(`Failed to auto-subscribe page ${page.id}. Error: ${err.message}`);
        }
      } catch (err) {
        logger.error(`Error processing page ${page.id}: ${err.message}`);
      }
    }

    res.status(200).json({
      status: 'success',
      message: `Successfully connected ${connectedAccounts.length} Facebook page(s).`,
      data: { accounts: connectedAccounts },
    });
  } catch (err) {
    next(err);
  }
};

exports.getAllAccounts = async (req, res, next) => {
  try {
    const accounts = await FacebookAccount.find({ user: req.user._id }).sort('-createdAt');
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
    const account = await FacebookAccount.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!account) return next(new AppError('Account not found', 404));

    res.status(204).json({ status: 'success', data: null });
  } catch (err) {
    next(err);
  }
};
