const AppError = require('../utils/AppError');
const InstagramAccount = require('../models/InstagramAccount');
const WhatsappAccount = require('../models/WhatsappAccount');
const TelegramAccount = require('../models/TelegramAccount');
const FacebookAccount = require('../models/FacebookAccount');
const SocialMediaHubService = require('../services/socialMediaHubService');
const SocialPostOrchestratorService = require('../services/socialPostOrchestratorService');
const SocialPostJob = require('../models/SocialPostJob');
const CloudinaryService = require('../services/cloudinaryService');
const GeminiImageService = require('../services/geminiImageService');
const logger = require('../utils/logger');

// ─── Get Connected Accounts ────────────────────────────────────────────────
exports.getConnectedAccounts = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const igAccounts = await InstagramAccount.find({ user: userId });
    const fbAccounts = await FacebookAccount.find({ user: userId });
    const waAccounts = await WhatsappAccount.find({ user: userId });
    const tgAccounts = await TelegramAccount.find({ user: userId });

    const accounts = [];
    const connectedFbPageIds = new Set();

    igAccounts.forEach(acc => {
      const accId = acc._id.toString();
      accounts.push({
        id: accId,
        platform: 'instagram',
        name: acc.igUsername || acc.pageName || 'Instagram Account',
        type: 'Business Account',
        status: acc.status,
        modelId: acc._id,
        tokenValidity: acc.status === 'error' ? 'expired' : 'valid',
        reconnectPath: '/instagram',
        errorMessage: acc.errorMessage || '',
      });

      accounts.push({
        id: `fb_${accId}`,
        platform: 'facebook',
        name: acc.pageName || 'Facebook Page',
        type: 'Business Page',
        status: acc.status,
        modelId: acc._id,
        tokenValidity: acc.status === 'error' ? 'expired' : 'valid',
        reconnectPath: '/instagram',
        errorMessage: acc.errorMessage || '',
      });
      connectedFbPageIds.add(acc.pageId);
    });

    fbAccounts.forEach(acc => {
      if (!connectedFbPageIds.has(acc.pageId)) {
        const accId = acc._id.toString();
        accounts.push({
          id: `fb_native_${accId}`,
          platform: 'facebook',
          name: acc.pageName || 'Facebook Page',
          type: 'Business Page',
          status: acc.status,
          modelId: acc._id,
          tokenValidity: acc.status === 'error' ? 'expired' : 'valid',
          reconnectPath: '/facebook',
          errorMessage: acc.errorMessage || '',
        });
      }
    });

    waAccounts.forEach(acc => {
      accounts.push({
        id: acc._id,
        platform: 'whatsapp',
        name: acc.verifiedName || acc.displayPhoneNumber || 'WhatsApp Account',
        type: 'Business API',
        status: acc.status,
        modelId: acc._id,
        tokenValidity: acc.status === 'error' ? 'expired' : 'valid',
        reconnectPath: '/whatsapp',
        errorMessage: acc.errorMessage || '',
      });
    });

    tgAccounts.forEach(acc => {
      accounts.push({
        id: acc._id,
        platform: 'telegram',
        name: acc.botName || acc.botUsername || 'Telegram Bot',
        type: 'Bot API',
        status: acc.status,
        modelId: acc._id,
        tokenValidity: acc.status === 'error' ? 'expired' : 'valid',
        reconnectPath: '/telegram',
        defaultChatId: acc.defaultChatId || '',
        errorMessage: acc.errorMessage || '',
      });
    });

    res.status(200).json({
      status: 'success',
      data: accounts
    });
  } catch (err) {
    next(err);
  }
};

// Helper to ensure mediaUrls are always valid HTTP URLs (e.g. if a base64 string gets through)
const ensurePublicMediaUrls = async (urls) => {
  if (!urls || !Array.isArray(urls)) return [];
  const processed = [];
  for (const url of urls) {
    if (url && (url.startsWith('data:image') || url.startsWith('data:video'))) {
      const uploaded = await CloudinaryService.upload(url, { folder: 'social_hub/processed_data_urls' });
      processed.push(uploaded.url);
    } else {
      processed.push(url);
    }
  }
  return processed;
};

// ─── Publish Content ──────────────────────────────────────────────────────
exports.publishContent = async (req, res, next) => {
  try {
    let { type, caption, mediaUrls, platforms, hashtags = [], ctaText = '', link = '', mode = 'instant', scheduledAt } = req.body;

    logger.info(`Publishing request: Type=${type}, Caption=${caption?.substring(0, 20)}..., MediaCount=${mediaUrls?.length}, PlatformCount=${platforms?.length}`);
    if (mediaUrls) {
      mediaUrls.forEach((url, i) => logger.info(`Media URL [${i}]: ${url?.substring(0, 50)}${url?.length > 50 ? '...' : ''}`));
    }

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return next(new AppError('Please select at least one platform', 400));
    }

    const platformConfigs = await SocialPostOrchestratorService.buildPlatformConfigs(req.user._id, platforms);

    // Ensure all mediaUrls are public HTTP urls
    const publicMediaUrls = await ensurePublicMediaUrls(mediaUrls);

    const masterContent = {
      text: caption || '',
      mediaUrls: publicMediaUrls || [],
      hashtags,
      ctaText,
      link,
      type,
    };
    const compatibility = SocialPostOrchestratorService.validateCompatibility({
      ...masterContent,
      platforms: platformConfigs,
    });

    if (!compatibility.compatible) {
      return res.status(400).json({
        status: 'fail',
        message: 'Some platforms require fixes before publishing.',
        data: compatibility,
      });
    }

    const isScheduled = mode === 'scheduled';
    const scheduleDate = isScheduled ? new Date(scheduledAt) : null;
    if (isScheduled && (!scheduleDate || Number.isNaN(scheduleDate.getTime()))) {
      return next(new AppError('Valid schedule date/time is required.', 400));
    }

    const job = await SocialPostOrchestratorService.createJob({
      userId: req.user._id,
      masterContent,
      mode: isScheduled ? 'scheduled' : 'instant',
      scheduledAt: scheduleDate,
      platforms: platformConfigs,
    });

    if (!isScheduled) {
      await SocialPostOrchestratorService.runJob(job);
    }

    const latest = await SocialPostJob.findById(job._id);
    res.status(200).json({
      status: 'success',
      message: isScheduled ? 'Post scheduled successfully' : 'Publishing process completed',
      data: latest,
    });
  } catch (err) {
    next(err);
  }
};

exports.validatePost = async (req, res, next) => {
  try {
    let { caption = '', mediaUrls = [], hashtags = [], ctaText = '', link = '', type = 'post', platforms = [] } = req.body;

    const publicMediaUrls = await ensurePublicMediaUrls(mediaUrls);

    const platformConfigs = await SocialPostOrchestratorService.buildPlatformConfigs(req.user._id, platforms);
    const data = SocialPostOrchestratorService.validateCompatibility({
      text: caption,
      mediaUrls: publicMediaUrls,
      hashtags,
      ctaText,
      link,
      type,
      platforms: platformConfigs,
    });
    res.status(200).json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
};

exports.formatPreview = async (req, res, next) => {
  try {
    const { caption = '', hashtags = [], ctaText = '', link = '', platforms = [] } = req.body;
    const previews = platforms.map((p) => ({
      platform: p.platform,
      content: SocialPostOrchestratorService.formatForPlatform({
        platform: p.platform,
        text: caption,
        hashtags,
        ctaText,
        link,
      }),
    }));
    res.status(200).json({ status: 'success', data: previews });
  } catch (err) {
    next(err);
  }
};

exports.getPublishingHistory = async (req, res, next) => {
  try {
    const history = await SocialPostJob.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
    res.status(200).json({ status: 'success', data: history });
  } catch (err) {
    next(err);
  }
};

exports.retryFailedPlatform = async (req, res, next) => {
  try {
    const { jobId, platform } = req.body;
    if (!jobId || !platform) return next(new AppError('jobId and platform are required', 400));
    const updated = await SocialPostOrchestratorService.retryFailedPlatform({
      jobId,
      userId: req.user._id,
      platform,
    });
    res.status(200).json({ status: 'success', data: updated });
  } catch (err) {
    next(err);
  }
};

exports.getPublishingAnalytics = async (req, res, next) => {
  try {
    const metrics = await SocialPostOrchestratorService.analytics(req.user._id);
    res.status(200).json({ status: 'success', data: metrics });
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
      if (p.platform === 'facebook' && typeof p.id === 'string' && p.id.startsWith('fb_native_')) {
        const targetModelId = p.id.replace('fb_native_', '');
        const FacebookAccount = require('../models/FacebookAccount');
        const acc = await FacebookAccount.findOne({ _id: targetModelId, user: req.user._id })
          .select('+pageAccessToken +pageId');
        if (acc) {
          platformConfigs.push({
            id: p.id,
            platform: 'facebook',
            name: p.name,
            accessToken: acc.pageAccessToken,
            pageId: acc.pageId,
          });
        }
        continue;
      }

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
    const fbAccounts = require('../models/FacebookAccount').find({ user: req.user._id })
      .select('+pageAccessToken +pageId');

    const [ig, fbNative] = await Promise.all([igAccounts, fbAccounts]);

    const platformConfigs = [];
    const connectedFbPageIds = new Set();

    ig.forEach(acc => {
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
        connectedFbPageIds.add(acc.pageId);
      }
    });

    fbNative.forEach(acc => {
      if (acc.status === 'connected' && !connectedFbPageIds.has(acc.pageId)) {
        platformConfigs.push({
          id: `fb_native_${acc._id}`,
          platform: 'facebook',
          accessToken: acc.pageAccessToken,
          pageId: acc.pageId
        });
      }
    });

    const feed = await SocialMediaHubService.getFeed(platformConfigs);

    // Fetch jobs from database (scheduled, failed, partially_failed)
    const jobs = await SocialPostJob.find({
      user: req.user._id,
      overallStatus: { $in: ['queued', 'failed', 'partially_failed', 'processing'] },
    }).sort({ createdAt: -1 });

    const mappedJobs = jobs.map(job => ({
      id: job._id,
      jobId: job._id,
      caption: job.masterContent.text,
      mediaUrl: job.masterContent.mediaUrls?.[0],
      platform: job.selectedPlatforms?.[0] || 'multiple',
      platforms: job.selectedPlatforms || [],
      executions: job.executions, // Pass executions to frontend for granular status
      timestamp: job.scheduledAt || job.createdAt,
      mode: job.mode,
      overallStatus: job.overallStatus,
      isJob: true,
      type: job.masterContent.type || 'post'
    }));

    res.status(200).json({
      status: 'success',
      data: [...mappedJobs, ...feed]
    });
  } catch (err) {
    next(err);
  }
};

// ─── Delete Post ──────────────────────────────────────────────────────────
exports.deletePost = async (req, res, next) => {
  try {
    const { platform, postId, accountId, isJob, jobId } = req.body;

    if (isJob || jobId) {
      const deleted = await SocialPostJob.findOneAndDelete({ _id: jobId || postId, user: req.user._id });
      if (!deleted) return next(new AppError('Job not found', 404));
      return res.status(200).json({ status: 'success', message: 'Scheduled post deleted' });
    }

    if (!platform || !postId || !accountId) {
      return next(new AppError('platform, postId, and accountId are required', 400));
    }

    if (platform === 'facebook' && typeof accountId === 'string' && accountId.startsWith('fb_native_')) {
      const targetModelId = accountId.replace('fb_native_', '');
      const FacebookAccount = require('../models/FacebookAccount');
      const acc = await FacebookAccount.findOne({ _id: targetModelId, user: req.user._id })
        .select('+pageAccessToken +pageId');
      if (!acc) return next(new AppError('Account not found', 404));
      await SocialMediaHubService.deletePost({
        platform,
        postId,
        accessToken: acc.pageAccessToken,
        pageId: acc.pageId
      });
      return res.status(200).json({ status: 'success' });
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

// Generate image using Gemini and return a hosted URL compatible with publish flow
exports.generateImage = async (req, res, next) => {
  try {
    const { prompt, style, aspectRatio } = req.body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return next(new AppError('Prompt is required', 400));
    }

    const generated = await GeminiImageService.generateImage({
      prompt: prompt.trim(),
      style,
      aspectRatio,
    });

    // Persist the generated image so it can be reused exactly like uploaded files.
    const uploaded = await CloudinaryService.upload(generated.dataUrl, {
      resource_type: 'image',
      folder: 'social_hub/ai_generated',
      format: 'png',
    });

    res.status(200).json({
      status: 'success',
      data: {
        prompt: prompt.trim(),
        style,
        aspectRatio,
        resourceType: 'image',
        url: uploaded.url,
        publicId: uploaded.publicId,
        base64: generated.base64Data,
        mimeType: generated.mimeType,
      },
    });
  } catch (err) {
    next(err);
  }
};
exports.updateScheduledJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { caption, mediaUrls, mode, scheduledAt, platforms } = req.body;

    const job = await SocialPostJob.findOne({ _id: jobId, user: req.user._id });
    if (!job) return next(new AppError('Scheduled post not found', 404));

    if (job.overallStatus !== 'queued') {
      return next(new AppError('Only queued posts can be edited', 400));
    }

    if (caption) job.masterContent.text = caption;
    if (mediaUrls) job.masterContent.mediaUrls = mediaUrls;
    if (mode) job.mode = mode;
    if (scheduledAt) job.scheduledAt = scheduledAt;
    if (platforms) {
      job.selectedPlatforms = platforms.map(p => p.platform);
      job.executions = platforms.map(p => ({
        platform: p.platform,
        accountId: String(p.id),
        accountName: p.name,
        status: 'pending',
        formattedContent: SocialPostOrchestratorService.formatForPlatform({
          platform: p.platform,
          text: caption || job.masterContent.text,
          mediaUrls: mediaUrls || job.masterContent.mediaUrls
        })
      }));
    }

    await job.save();
    res.status(200).json({ status: 'success', data: job });
  } catch (err) {
    next(err);
  }
};