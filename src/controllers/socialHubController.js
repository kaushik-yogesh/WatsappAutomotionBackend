const AppError = require('../utils/AppError');
const InstagramAccount = require('../models/InstagramAccount');
const WhatsappAccount = require('../models/WhatsappAccount');
const TelegramAccount = require('../models/TelegramAccount');
const SocialMediaHubService = require('../services/socialMediaHubService');
const logger = require('../utils/logger');

// ─── Get Connected Accounts ────────────────────────────────────────────────
exports.getConnectedAccounts = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Fetch from all schemas
    const igAccounts = await InstagramAccount.find({ user: userId });
    const waAccounts = await WhatsappAccount.find({ user: userId });
    const tgAccounts = await TelegramAccount.find({ user: userId });

    const accounts = [];

    igAccounts.forEach(acc => {
      if (acc.status === 'connected') {
        // Instagram Account
        accounts.push({
          id: acc._id,
          platform: 'instagram',
          name: acc.igUsername || acc.pageName || 'Instagram Account',
          type: 'Business Account',
          status: 'connected',
          modelId: acc._id
        });

        // Associated Facebook Page (since Instagram Business requires a FB Page)
        accounts.push({
          id: `fb_${acc._id}`, // Virtual ID to distinguish from IG
          platform: 'facebook',
          name: acc.pageName || 'Facebook Page',
          type: 'Business Page',
          status: 'connected',
          modelId: acc._id
        });
      }
    });

    waAccounts.forEach(acc => {
      if (acc.status === 'connected') {
        accounts.push({
          id: acc._id,
          platform: 'whatsapp',
          name: acc.verifiedName || acc.displayPhoneNumber || 'WhatsApp Account',
          type: 'Business API',
          status: 'connected',
          modelId: acc._id
        });
      }
    });

    tgAccounts.forEach(acc => {
      if (acc.status === 'connected') {
        accounts.push({
          id: acc._id,
          platform: 'telegram',
          name: acc.botName || acc.botUsername || 'Telegram Bot',
          type: 'Bot API',
          status: 'connected',
          modelId: acc._id
        });
      }
    });

    res.status(200).json({
      status: 'success',
      data: accounts
    });
  } catch (err) {
    next(err);
  }
};

// ─── Publish Content ──────────────────────────────────────────────────────
exports.publishContent = async (req, res, next) => {
  try {
    const { type, caption, mediaUrls, platforms } = req.body;
    
    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return next(new AppError('Please select at least one platform', 400));
    }

    // Resolve credentials for each platform
    const platformConfigs = [];
    for (const p of platforms) {
      // For FB virtual ID, we use the modelId which is the IG account ID
      const targetModelId = p.platform === 'facebook' && typeof p.id === 'string' && p.id.startsWith('fb_') 
        ? p.id.replace('fb_', '') 
        : p.id;

      if (p.platform === 'instagram' || p.platform === 'facebook') {
        const acc = await InstagramAccount.findOne({ _id: targetModelId, user: req.user._id })
          .select('+pageAccessToken +pageId +igAccountId');
        
        if (acc) {
          platformConfigs.push({
            id: p.id,
            platform: p.platform,
            name: p.name,
            accessToken: acc.pageAccessToken,
            pageId: acc.pageId,
            igAccountId: acc.igAccountId
          });
        }
      } else {
        // Placeholder for other platforms (Telegram, WhatsApp)
        platformConfigs.push({ ...p });
      }
    }

    const results = await SocialMediaHubService.publishToAll({
      type,
      caption,
      mediaUrls,
      platforms: platformConfigs
    });

    res.status(200).json({
      status: 'success',
      message: 'Publishing process completed',
      results
    });
  } catch (err) {
    next(err);
  }
};

// ─── Update Profile ───────────────────────────────────────────────────────
exports.updateProfile = async (req, res, next) => {
  try {
    const { name, description, platforms } = req.body;
    
    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return next(new AppError('Please select at least one platform', 400));
    }

    // Resolve credentials
    const platformConfigs = [];
    for (const p of platforms) {
      const targetModelId = p.platform === 'facebook' && typeof p.id === 'string' && p.id.startsWith('fb_') 
        ? p.id.replace('fb_', '') 
        : p.id;

      if (p.platform === 'instagram' || p.platform === 'facebook') {
        const acc = await InstagramAccount.findOne({ _id: targetModelId, user: req.user._id })
          .select('+pageAccessToken +pageId +igAccountId');
        
        if (acc) {
          platformConfigs.push({
            id: p.id,
            platform: p.platform,
            name: p.name,
            accessToken: acc.pageAccessToken,
            pageId: acc.pageId,
            igAccountId: acc.igAccountId
          });
        }
      } else {
        platformConfigs.push({ ...p });
      }
    }

    const results = await SocialMediaHubService.updateProfiles({
      name,
      description,
      platforms: platformConfigs
    });

    res.status(200).json({
      status: 'success',
      message: 'Profile update process completed',
      results
    });
  } catch (err) {
    next(err);
  }
};
