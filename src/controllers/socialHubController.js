const AppError = require('../utils/AppError');
const InstagramAccount = require('../models/InstagramAccount');
const WhatsappAccount = require('../models/WhatsappAccount');
const TelegramAccount = require('../models/TelegramAccount');
const InstagramService = require('../services/instagramService');
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
        accounts.push({
          id: acc._id,
          platform: 'instagram',
          name: acc.igUsername || acc.pageName || 'Instagram Account',
          type: 'Business Account',
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

    const results = [];
    
    // Simulate real publishing process by trying to route to Instagram Service if Instagram is selected
    for (const p of platforms) {
      if (p.platform === 'instagram') {
        // Find the account and populate tokens
        const acc = await InstagramAccount.findOne({ _id: p.id, user: req.user._id }).select('+pageAccessToken +pageId +igAccountId');
        if (!acc) continue;
        
        try {
          const igService = new InstagramService(acc.pageAccessToken, acc.pageId, acc.igAccountId);
          
          if (type === 'post') {
            // For now, since media uploading is complex, we just simulate or use Meta graph API to post text/link
            // Note: Instagram requires an image/video for posts. This is a placeholder for future S3 integration.
            // await igService.publishPhoto(mediaUrls[0], caption);
            results.push({ platform: 'instagram', status: 'success', message: 'Instagram post published (mocked API call)' });
          } else {
            results.push({ platform: 'instagram', status: 'success', message: `Instagram ${type} published (mocked API call)` });
          }
        } catch (err) {
          logger.error(`Instagram publish error: ${err.message}`);
          results.push({ platform: 'instagram', status: 'error', message: err.message });
        }
      } else {
        // Other platforms mocked
        results.push({ platform: p.platform, status: 'success', message: `Published to ${p.platform} (mocked API call)` });
      }
    }

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

    const results = [];

    // Simulate Profile Update
    for (const p of platforms) {
      if (p.platform === 'instagram') {
         // Note: Graph API does not easily allow updating IG Business Profile name/bio via API (requires Page admin tools)
         // but this is mocked for the user request.
         results.push({ platform: 'instagram', status: 'success', message: 'Instagram profile updated (mocked API call)' });
      } else {
         results.push({ platform: p.platform, status: 'success', message: `Profile updated on ${p.platform} (mocked API call)` });
      }
    }

    res.status(200).json({
      status: 'success',
      message: 'Profile update process completed',
      results
    });
  } catch (err) {
    next(err);
  }
};
