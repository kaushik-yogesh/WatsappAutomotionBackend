const SocialPostJob = require('../models/SocialPostJob');
const InstagramAccount = require('../models/InstagramAccount');
const TelegramAccount = require('../models/TelegramAccount');
const FacebookAccount = require('../models/FacebookAccount');
const InstagramService = require('./instagramService');
const FacebookService = require('./facebookService');
const TelegramService = require('./telegramService');
const logger = require('../utils/logger');
const { emitToUser } = require('../utils/socket');

const MAX_GBP_TEXT = 1500;
const BASE_RETRY_DELAY_MS = 2500;

const normalizeHashtags = (hashtags = []) =>
  hashtags
    .map((h) => String(h || '').trim())
    .filter(Boolean)
    .map((h) => (h.startsWith('#') ? h : `#${h}`));

const normalizeType = (rawType = 'post') => {
  const value = String(rawType || 'post').trim().toLowerCase();
  if (value === 'carosul') return 'carousel';
  if (['post', 'reel', 'story', 'carousel'].includes(value)) return value;
  return 'post';
};

const asErrorText = (err) => {
  if (!err) return '';
  if (typeof err === 'string') return err;

  const pieces = [
    err.message,
    err.response?.data?.error?.message,
    err.response?.data?.message,
  ].filter(Boolean);

  if (pieces.length > 0) return pieces.join(' | ');

  try {
    return JSON.stringify(err.response?.data || err);
  } catch (_e) {
    return 'Unknown publish error';
  }
};

const humanizeError = (rawMessage = '') => {
  const msg = String(rawMessage).toLowerCase();

  if (msg.includes('unknown error') || (msg.includes('code":1') && msg.includes('oauthexception'))) {
    return 'Meta (Facebook/Instagram) temporary issue detected. Please retry shortly.';
  }

  if (
    msg.includes('expired') ||
    msg.includes('access token') ||
    (msg.includes('oauth') && (msg.includes('token') || msg.includes('session') || msg.includes('validate')))
  ) {
    return 'Your account session expired. Please reconnect this platform.';
  }

  if (msg.includes('rate limit') || msg.includes('too many')) return 'Platform rate limit reached. Please retry in a few minutes.';
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('socket hang up') || msg.includes('temporar')) {
    return 'Temporary network issue detected. Please retry.';
  }
  if (msg.includes('unsupported') || msg.includes('format') || msg.includes('invalid image') || msg.includes('invalid video')) {
    return 'This media format is not supported for this platform.';
  }
  if (msg.includes('requires at least one valid image') || msg.includes('requires media')) {
    return 'This platform requires at least one valid media file for this post type.';
  }

  return 'Publishing failed. Please review content and try again.';
};

const classifyError = (rawMessage = '') => {
  const msg = String(rawMessage).toLowerCase();

  const isUnknownMeta = msg.includes('unknown error') || (msg.includes('code":1') && msg.includes('oauthexception'));

  const tokenError =
    !isUnknownMeta &&
    (msg.includes('access token') ||
      msg.includes('session has expired') ||
      msg.includes('token expired') ||
      (msg.includes('oauth') && (msg.includes('token') || msg.includes('session') || msg.includes('validate'))) ||
      msg.includes('reauthorize') ||
      msg.includes('reconnect'));

  const transient =
    isUnknownMeta ||
    msg.includes('timeout') ||
    msg.includes('temporar') ||
    msg.includes('network') ||
    msg.includes('socket hang up') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('media is not ready') ||
    msg.includes('not ready for publishing');

  return {
    tokenError,
    transient,
  };
};

class SocialPostOrchestratorService {
  static async buildPlatformConfigs(userId, requestedPlatforms = []) {
    const configs = [];
    logger.info(`Building platform configs for user ${userId}. Requested: ${requestedPlatforms.length}`);

    for (const p of requestedPlatforms) {
      const pid = String(p.id || '');
      logger.info(`Processing platform request: ${p.platform}, id: ${pid}`);

      if (p.platform === 'facebook' && pid.startsWith('fb_native_')) {
        const targetModelId = pid.replace('fb_native_', '');
        const acc = await FacebookAccount.findOne({ _id: targetModelId, user: userId }).select('+pageAccessToken +pageId');

        if (!acc) {
          logger.warn(`Account not found: platform=${p.platform}, targetModelId=${targetModelId}, user=${userId}`);
          continue;
        }

        configs.push({
          id: pid,
          modelId: targetModelId,
          platform: 'facebook',
          name: p.name,
          accessToken: acc.pageAccessToken,
          pageId: acc.pageId,
          status: acc.status === 'error' || acc.status === 'disconnected' ? 'error' : 'connected',
          reconnectPath: '/facebook',
        });
        continue;
      }

      const targetModelId = p.platform === 'facebook' && pid.startsWith('fb_') ? pid.replace('fb_', '') : pid;

      if (p.platform === 'instagram' || p.platform === 'facebook') {
        const acc = await InstagramAccount.findOne({ _id: targetModelId, user: userId }).select('+pageAccessToken +pageId +igAccountId');

        if (!acc) {
          logger.warn(`Account not found: platform=${p.platform}, targetModelId=${targetModelId}, user=${userId}`);
          continue;
        }

        configs.push({
          id: pid,
          modelId: targetModelId,
          platform: p.platform,
          name: p.name,
          accessToken: acc.pageAccessToken,
          pageId: acc.pageId,
          igAccountId: acc.igAccountId,
          status: acc.status === 'error' || acc.status === 'disconnected' ? 'error' : 'connected',
          reconnectPath: '/instagram',
        });
        continue;
      }

      if (p.platform === 'telegram') {
        const acc = await TelegramAccount.findOne({ _id: targetModelId, user: userId }).select('+botToken');
        if (!acc) continue;

        configs.push({
          id: pid,
          modelId: targetModelId,
          platform: 'telegram',
          name: p.name || acc.botName || acc.botUsername,
          botToken: acc.botToken,
          status: acc.status === 'error' || acc.status === 'disconnected' ? 'error' : 'connected',
          defaultChatId: acc.defaultChatId || '',
          reconnectPath: '/telegram',
        });
      }
    }

    return configs;
  }

  static validateCompatibility({ text = '', mediaUrls = [], hashtags = [], ctaText = '', link = '', type = 'post', platforms = [] }) {
    const warnings = [];
    const requiredFixes = [];
    const normalizedHashtags = normalizeHashtags(hashtags);
    const mediaCount = (mediaUrls || []).filter(Boolean).length;
    const fullText = [text, ctaText, link].filter(Boolean).join('\n');
    const normalizedType = normalizeType(type);

    platforms.forEach((p) => {
      if (p.status !== 'connected') {
        requiredFixes.push({ platform: p.platform, message: 'Account is disconnected. Please reconnect before publishing.' });
      }

      if ((p.platform === 'instagram' || p.platform === 'facebook') && !p.accessToken) {
        requiredFixes.push({ platform: p.platform, message: 'Access token missing. Please reconnect this account.' });
      }

      if (p.platform === 'instagram' && mediaCount === 0) {
        requiredFixes.push({ platform: 'instagram', message: 'Instagram requires at least one image or video.' });
      }

      if (p.platform === 'instagram' && normalizedType === 'story' && mediaCount === 0) {
        requiredFixes.push({ platform: 'instagram', message: 'Instagram Story requires media.' });
      }

      if (p.platform === 'facebook' && normalizedType === 'story') {
        requiredFixes.push({ platform: 'facebook', message: 'Facebook Page Story publishing is not supported in this flow.' });
      }

      if (p.platform === 'telegram' && normalizedType === 'story') {
        requiredFixes.push({ platform: 'telegram', message: 'Telegram does not support Story format. Use post format.' });
      }

      if (p.platform === 'telegram' && !p.defaultChatId) {
        requiredFixes.push({ platform: 'telegram', message: 'Telegram target chat/channel is missing. Reconnect with a default chat id.' });
      }

      if (p.platform === 'google_business' && fullText.length > MAX_GBP_TEXT) {
        warnings.push({ platform: 'google_business', message: 'Google Business copy is long and will be trimmed.' });
      }

      if (p.platform === 'linkedin' && fullText.length < 30) {
        warnings.push({ platform: 'linkedin', message: 'LinkedIn posts perform better with more professional context.' });
      }

      if (normalizedHashtags.length > 12 && (p.platform === 'linkedin' || p.platform === 'facebook')) {
        warnings.push({ platform: p.platform, message: 'Too many hashtags may reduce readability on this platform.' });
      }
    });

    return { warnings, requiredFixes, compatible: requiredFixes.length === 0 };
  }

  static formatForPlatform({ platform, text = '', hashtags = [], ctaText = '', link = '' }) {
    const normalizedHashtags = normalizeHashtags(hashtags);
    const shortTags = normalizedHashtags.slice(0, 8);
    const lineLink = link ? `\n${link}` : '';
    const lineCta = ctaText ? `\n${ctaText}` : '';

    if (platform === 'instagram') {
      return {
        text: `${text}${lineCta}${lineLink}\n\n${normalizedHashtags.join(' ')}`.trim(),
        hashtags: normalizedHashtags,
        ctaText,
        link,
      };
    }

    if (platform === 'linkedin') {
      return {
        text: `${text}\n\n${ctaText}${lineLink}\n\n${shortTags.join(' ')}`.trim(),
        hashtags: shortTags,
        ctaText,
        link,
      };
    }

    if (platform === 'google_business') {
      const concise = `${text} ${ctaText}`.trim().slice(0, MAX_GBP_TEXT);
      return {
        text: `${concise}${lineLink}`.trim(),
        hashtags: [],
        ctaText,
        link,
      };
    }

    if (platform === 'facebook') {
      return {
        text: `${text}${lineCta}${lineLink}\n\n${shortTags.join(' ')}`.trim(),
        hashtags: shortTags,
        ctaText,
        link,
      };
    }

    return {
      text: `${text}${lineCta}${lineLink}\n\n${normalizedHashtags.join(' ')}`.trim(),
      hashtags: normalizedHashtags,
      ctaText,
      link,
    };
  }

  static async createJob({ userId, masterContent, mode = 'instant', scheduledAt, platforms }) {
    const normalizedType = normalizeType(masterContent.type || 'post');
    const normalizedContent = {
      ...masterContent,
      type: normalizedType,
      mediaUrls: (masterContent.mediaUrls || []).filter(Boolean),
      hashtags: normalizeHashtags(masterContent.hashtags || []),
    };

    const platformIds = platforms.map((p) => p.platform);
    const compatibility = this.validateCompatibility({ ...normalizedContent, platforms });

    const executions = platforms.map((p) => ({
      platform: p.platform,
      accountId: String(p.id),
      accountName: p.name,
      status: mode === 'instant' ? 'connecting' : 'pending',
      formattedContent: this.formatForPlatform({ platform: p.platform, ...normalizedContent }),
    }));

    return SocialPostJob.create({
      user: userId,
      masterContent: normalizedContent,
      mode,
      scheduledAt: mode === 'scheduled' ? scheduledAt : undefined,
      selectedPlatforms: platformIds,
      compatibility: {
        warnings: compatibility.warnings,
        requiredFixes: compatibility.requiredFixes,
      },
      overallStatus: mode === 'scheduled' ? 'queued' : 'processing',
      startedAt: mode === 'instant' ? new Date() : undefined,
      executions,
    });
  }

  static async runJob(job) {
    const jobDoc = typeof job.save === 'function' ? job : await SocialPostJob.findById(job._id);
    if (!jobDoc) return null;

    if (jobDoc.overallStatus !== 'processing') {
      jobDoc.overallStatus = 'processing';
      jobDoc.startedAt = jobDoc.startedAt || new Date();
      await jobDoc.save();
    }

    const platformConfigs = await this.buildPlatformConfigs(
      jobDoc.user,
      jobDoc.executions.map((e) => ({
        id: e.accountId,
        platform: e.platform,
        name: e.accountName,
      }))
    );

    for (const exec of jobDoc.executions) {
      if (exec.status === 'success') continue;

      const config = platformConfigs.find((c) => c.id === exec.accountId && c.platform === exec.platform);
      if (!config) {
        exec.status = 'failed';
        exec.errorMessage = 'Platform account not found.';
        exec.humanMessage = 'Account no longer connected. Please reconnect.';
        this.emitStatus(jobDoc.user, jobDoc._id, exec);
        continue;
      }

      exec.status = 'connecting';
      exec.humanMessage = '';
      this.emitStatus(jobDoc.user, jobDoc._id, exec);
      await jobDoc.save();

      const mediaUrls = (jobDoc.masterContent.mediaUrls || []).filter(Boolean);
      const requestedType = normalizeType(jobDoc.masterContent.type || 'post');
      const isTransientPlatform = exec.platform === 'instagram' || exec.platform === 'facebook';
      const maxAttempts = isTransientPlatform ? 3 : 2;

      let lastError = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        exec.attempts = (exec.attempts || 0) + 1;

        try {
          exec.status = 'publishing';
          exec.humanMessage = attempt > 1 ? `Retrying (attempt ${attempt}/${maxAttempts})...` : 'Publishing...';
          this.emitStatus(jobDoc.user, jobDoc._id, exec);

          let result;
          if (exec.platform === 'instagram') {
            const ig = new InstagramService(config.accessToken, config.pageId, config.igAccountId);
            const igType = requestedType === 'carousel' || mediaUrls.length > 1 ? 'carousel' : requestedType;
            result = await ig.publishPost({ caption: exec.formattedContent.text, mediaUrls, type: igType });
          } else if (exec.platform === 'facebook') {
            const fb = new FacebookService(config.accessToken, config.pageId);
            result = await fb.publishToFacebook(config, {
              text: exec.formattedContent.text,
              mediaUrls,
              type: requestedType,
            });
          } else if (exec.platform === 'telegram') {
            if (requestedType === 'story') {
              throw new Error('Telegram does not support Story format. Use post format.');
            }

            const tg = new TelegramService(config.botToken);
            const chatId = config.defaultChatId;
            if (!chatId) throw new Error('Telegram target chat/channel is missing.');

            if (mediaUrls.length > 1) {
              const media = mediaUrls.map((url, idx) => ({
                type: /\.(mp4|mov|avi|wmv|m4v|webm)$/i.test(url) ? 'video' : 'photo',
                media: url,
                caption: idx === 0 ? exec.formattedContent.text : undefined,
              }));
              result = await tg.sendMediaGroup(chatId, media);
            } else if (mediaUrls.length === 1) {
              const url = mediaUrls[0];
              if (/\.(mp4|mov|avi|wmv|m4v|webm)$/i.test(url)) {
                result = await tg.sendVideo(chatId, url, exec.formattedContent.text);
              } else {
                result = await tg.sendPhoto(chatId, url, exec.formattedContent.text);
              }
            } else {
              result = await tg.sendTextMessage(chatId, exec.formattedContent.text);
            }
          } else {
            throw new Error(`Platform ${exec.platform} is not supported yet.`);
          }

          exec.status = 'success';
          exec.publishedAt = new Date();
          exec.externalPostId = result?.id || result?.result?.message_id?.toString() || '';
          exec.errorMessage = '';
          exec.humanMessage = 'Published successfully.';
          this.emitStatus(jobDoc.user, jobDoc._id, exec);
          await jobDoc.save();
          lastError = null;
          break;
        } catch (err) {
          const errorText = asErrorText(err);
          const { tokenError, transient } = classifyError(errorText);
          lastError = errorText;

          if (tokenError) {
            exec.status = 'failed';
            exec.errorMessage = errorText;
            exec.humanMessage = 'Your account session expired. Please reconnect this platform.';
            this.emitStatus(jobDoc.user, jobDoc._id, exec);
            await this.markTokenHealthOnFailure(exec.platform, config.modelId, errorText);
            await jobDoc.save();
            break;
          }

          if (attempt >= maxAttempts || !transient) {
            exec.status = 'failed';
            exec.errorMessage = errorText;
            exec.humanMessage = humanizeError(errorText);
            this.emitStatus(jobDoc.user, jobDoc._id, exec);
            await jobDoc.save();
            break;
          }

          const delay = BASE_RETRY_DELAY_MS * attempt;
          exec.humanMessage = `Temporary issue detected, retrying in ${Math.round(delay / 1000)}s...`;
          this.emitStatus(jobDoc.user, jobDoc._id, exec);
          await jobDoc.save();
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      if (lastError && exec.status !== 'success' && !exec.errorMessage) {
        exec.errorMessage = lastError;
      }
    }

    const successCount = jobDoc.executions.filter((e) => e.status === 'success').length;
    const failedCount = jobDoc.executions.filter((e) => e.status === 'failed').length;

    jobDoc.completedAt = new Date();
    if (successCount === jobDoc.executions.length) jobDoc.overallStatus = 'completed';
    else if (failedCount === jobDoc.executions.length) jobDoc.overallStatus = 'failed';
    else jobDoc.overallStatus = 'partially_failed';

    await jobDoc.save();

    emitToUser(jobDoc.user.toString(), 'social_publish_completed', {
      jobId: jobDoc._id,
      overallStatus: jobDoc.overallStatus,
      executions: jobDoc.executions,
    });

    return jobDoc;
  }

  static emitStatus(userId, jobId, execution) {
    emitToUser(userId.toString(), 'social_publish_status', {
      jobId,
      platform: execution.platform,
      status: execution.status,
      attempts: execution.attempts,
      humanMessage: execution.humanMessage,
      errorMessage: execution.errorMessage,
    });
  }

  static async retryFailedPlatform({ jobId, userId, platform }) {
    const job = await SocialPostJob.findOne({ _id: jobId, user: userId });
    if (!job) throw new Error('Publish history item not found.');

    const exec = job.executions.find((e) => e.platform === platform && e.status === 'failed');
    if (!exec) throw new Error('No failed execution found for the selected platform.');

    exec.status = 'retrying';
    exec.humanMessage = 'Retrying publish...';
    job.overallStatus = 'processing';
    await job.save();

    return this.runJob(job);
  }

  static async markTokenHealthOnFailure(platform, modelId, rawErrorMessage) {
    const lower = String(rawErrorMessage || '').toLowerCase();

    if (lower.includes('media is not ready') || lower.includes('media id is not available') || lower.includes('unknown error')) {
      return;
    }

    const tokenIssue =
      lower.includes('access token') ||
      lower.includes('session has expired') ||
      lower.includes('token expired') ||
      (lower.includes('oauth') && lower.includes('validate'));

    if (!tokenIssue) return;

    try {
      if (platform === 'instagram') {
        await InstagramAccount.findByIdAndUpdate(modelId, {
          status: 'disconnected',
          errorMessage: 'Token expired. Please reconnect.',
        });
      }

      if (platform === 'facebook') {
        await FacebookAccount.findByIdAndUpdate(modelId, {
          status: 'disconnected',
          errorMessage: 'Token expired. Please reconnect.',
        });
      }

      if (platform === 'telegram') {
        await TelegramAccount.findByIdAndUpdate(modelId, {
          status: 'disconnected',
          errorMessage: 'Token expired or invalid. Please reconnect.',
        });
      }
    } catch (err) {
      logger.warn(`Could not update token health for ${platform}:${modelId} - ${err.message}`);
    }
  }

  static async analytics(userId) {
    const jobs = await SocialPostJob.find({ user: userId });
    const totalPosts = jobs.length;
    const scheduledPosts = jobs.filter((j) => j.mode === 'scheduled').length;
    const failedPosts = jobs.filter((j) => ['failed', 'partially_failed'].includes(j.overallStatus)).length;

    const platformStats = {};
    jobs.forEach((j) => {
      j.executions.forEach((e) => {
        platformStats[e.platform] = platformStats[e.platform] || { total: 0, success: 0 };
        platformStats[e.platform].total += 1;
        if (e.status === 'success') platformStats[e.platform].success += 1;
      });
    });

    const platformWiseSuccessRate = Object.entries(platformStats).map(([platform, v]) => ({
      platform,
      successRate: v.total ? Math.round((v.success / v.total) * 100) : 0,
      total: v.total,
    }));

    const mostUsedPlatform = platformWiseSuccessRate.sort((a, b) => b.total - a.total)[0]?.platform || null;

    return {
      totalPostsPublished: totalPosts,
      scheduledPosts,
      failedPosts,
      platformWiseSuccessRate,
      mostUsedPlatform,
    };
  }
}

module.exports = SocialPostOrchestratorService;
