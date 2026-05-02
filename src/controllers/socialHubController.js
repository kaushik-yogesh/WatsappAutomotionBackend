const AppError = require('../utils/AppError');
const InstagramAccount = require('../models/InstagramAccount');
const WhatsappAccount = require('../models/WhatsappAccount');
const TelegramAccount = require('../models/TelegramAccount');
const SocialMediaHubService = require('../services/socialMediaHubService');
const CloudinaryService = require('../services/cloudinaryService');
const logger = require('../utils/logger');

// ─── Get Connected Accounts ────────────────────────────────────────────────
exports.getConnectedAccounts = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const igAccounts = await InstagramAccount.find({ user: userId });
    const waAccounts = await WhatsappAccount.find({ user: userId });
    const tgAccounts = await TelegramAccount.find({ user: userId });

    const accounts = [];

    igAccounts.forEach(acc => {
      if (acc.status === 'connected') {
        accounts.push({
          id: acc._id,
          platform: 'instagram',
          name: acc.igUsername || acc.pageName || 'Instagram Account',
          type: 'Business Account',
          status: 'connected',
          modelId: acc._id
        });

        accounts.push({
          id: `fb_${acc._id}`,
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
    
    logger.info(`Publishing request: Type=${type}, Caption=${caption?.substring(0, 20)}..., MediaCount=${mediaUrls?.length}, PlatformCount=${platforms?.length}`);
    if (mediaUrls) {
      mediaUrls.forEach((url, i) => logger.info(`Media URL [${i}]: ${url?.substring(0, 50)}${url?.length > 50 ? '...' : ''}`));
    }

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return next(new AppError('Please select at least one platform', 400));
    }

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

// ─── Upload Media ─────────────────────────────────────────────────────────
exports.uploadMedia = async (req, res, next) => {
  try {
    if (!req.files || Object.keys(req.files).length === 0) {
      return next(new AppError('No files were uploaded', 400));
    }

    const file = req.files.file;
    logger.info(`Uploading file to Cloudinary: ${file.name} (${file.size} bytes)`);
    
    const result = await CloudinaryService.upload(file.tempFilePath, {
      resource_type: 'auto',
      folder: 'social_hub'
    });

    res.status(200).json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get Feed ─────────────────────────────────────────────────────────────
exports.getFeed = async (req, res, next) => {
  try {
    const igAccounts = await InstagramAccount.find({ user: req.user._id })
      .select('+pageAccessToken +pageId +igAccountId');
    
    const platformConfigs = [];
    igAccounts.forEach(acc => {
      if (acc.status === 'connected') {
        platformConfigs.push({
          id: acc._id,
          platform: 'instagram',
          accessToken: acc.pageAccessToken,
          pageId: acc.pageId,
          igAccountId: acc.igAccountId
        });

        platformConfigs.push({
          id: `fb_${acc._id}`,
          platform: 'facebook',
          accessToken: acc.pageAccessToken,
          pageId: acc.pageId
        });
      }
    });

    const feed = await SocialMediaHubService.getFeed(platformConfigs);

    res.status(200).json({
      status: 'success',
      data: feed
    });
  } catch (err) {
    next(err);
  }
};

// ─── Delete Post ──────────────────────────────────────────────────────────
exports.deletePost = async (req, res, next) => {
  try {
    const { platform, postId, accountId } = req.body;

    if (!platform || !postId || !accountId) {
      return next(new AppError('platform, postId, and accountId are required', 400));
    }

    const targetModelId = platform === 'facebook' && typeof accountId === 'string' && accountId.startsWith('fb_') 
      ? accountId.replace('fb_', '') 
      : accountId;

    const acc = await InstagramAccount.findOne({ _id: targetModelId, user: req.user._id })
      .select('+pageAccessToken +pageId +igAccountId');

    if (!acc) return next(new AppError('Account not found', 404));

    await SocialMediaHubService.deletePost({
      platform,
      postId,
      accessToken: acc.pageAccessToken,
      pageId: acc.pageId,
      igAccountId: acc.igAccountId
    });

    res.status(200).json({
      status: 'success',
      message: 'Post deleted successfully'
    });
  } catch (err) {
    next(err);
  }
};
