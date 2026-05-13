const YoutubeAutomation = require('../models/YoutubeAutomation');
const User = require('../models/User');
const YoutubeProvider = require('./youtubeProvider');
const AIService = require('./aiService');
const logger = require('../utils/logger');

class YoutubeAutomationService {
  /**
   * Main job to process YouTube comments for all active automations
   */
  static async runAutomation() {
    try {
      logger.info('[YouTube Automation] Starting comment check cycle...');
      
      const automations = await YoutubeAutomation.find({ enabled: true }).populate({
        path: 'user',
        select: '+youtube.accessToken +youtube.refreshToken'
      });
      
      for (const automation of automations) {
        try {
          await this.processUserAutomation(automation);
        } catch (err) {
          logger.error(`[YouTube Automation] Error processing user ${automation.user?.email}:`, err.message);
          
          // Handle specific OAuth errors by disconnecting if necessary
          if (err.response?.data?.error === 'invalid_grant' || err.message === 'TOKEN_EXPIRED') {
             logger.warn(`[YouTube Automation] Critical OAuth error for ${automation.user?.email}. Disconnecting YouTube.`);
             await User.findByIdAndUpdate(automation.user._id, { 'youtube.connected': false });
          }
        }
      }
      
      logger.info('[YouTube Automation] Cycle completed.');
    } catch (err) {
      logger.error('[YouTube Automation] Fatal error in cycle:', err.message);
    }
  }

  /**
   * Process automation for a single user
   */
  static async processUserAutomation(automation) {
    const user = automation.user;
    if (!user || !user.youtube?.connected) return;

    // Initialize provider
    const provider = new YoutubeProvider(
      user.youtube.accessToken,
      user.youtube.refreshToken,
      user.youtube.tokenExpiry,
      user.youtube.channelId
    );

    // Refresh token if needed
    if (user.youtube.tokenExpiry && new Date(user.youtube.tokenExpiry) <= new Date()) {
      logger.info(`[YouTube Automation] Refreshing token for ${user.email}`);
      await provider.refreshYouTubeToken(user._id);
    }

    // Fetch latest comments with retry on 401
    let threads;
    try {
      threads = await provider.fetchLatestComments(20);
    } catch (err) {
      if (err.message === 'TOKEN_EXPIRED') {
        logger.info(`[YouTube Automation] Token expired for ${user.email}, refreshing and retrying...`);
        const refreshed = await provider.refreshYouTubeToken(user._id);
        provider.accessToken = refreshed.accessToken;
        threads = await provider.fetchLatestComments(20);
        logger.info(`[YouTube Automation] Successfully retried with refreshed token for ${user.email}`);
      } else {
        throw err;
      }
    }

    if (!threads || threads.length === 0) return;

    for (const thread of threads) {
      const topComment = thread.snippet.topLevelComment;
      const commentId = topComment.id;
      const commentText = topComment.snippet.textOriginal;
      const authorName = topComment.snippet.authorDisplayName;

      // Skip if already replied or processed
      if (automation.repliedCommentIds.includes(commentId)) continue;
      if (automation.pendingComments.some(c => c.commentId === commentId)) continue;

      // Skip if author is the channel itself
      if (topComment.snippet.authorChannelId?.value === user.youtube.channelId) continue;

      logger.info(`[YouTube Automation] New comment from ${authorName}: ${commentText.substring(0, 30)}...`);

      // Generate AI Reply
      const aiResponse = await AIService.generateOpenRouter({
        messages: [
          { role: 'system', content: automation.aiPrompt },
          { role: 'user', content: `Comment from ${authorName}: ${commentText}` }
        ],
        maxTokens: 150
      });

      const replyText = aiResponse.content;

      if (automation.automationMode === 'auto') {
        // Auto-reply
        const success = await provider.replyToCommentThread(commentId, replyText);
        if (success) {
          automation.repliedCommentIds.push(commentId);
          logger.info(`[YouTube Automation] Auto-replied to ${commentId}`);
        }
      } else {
        // Manual mode - Save to pending
        automation.pendingComments.push({
          commentId,
          authorName,
          authorThumbnail: topComment.snippet.authorProfileImageUrl,
          text: commentText,
          videoId: thread.snippet.videoId,
          videoTitle: 'YouTube Video', // API doesn't return title in commentThreads.list, would need another call
          publishedAt: topComment.snippet.publishedAt,
          aiSuggestedReply: replyText,
          status: 'pending'
        });
        logger.info(`[YouTube Automation] Saved comment to pending for manual approval: ${commentId}`);
      }
    }

    automation.lastCheckedAt = new Date();
    await automation.save();
  }

  /**
   * Manual approval of a pending comment
   */
  static async approveReply(userId, commentId, customReply = null) {
    const automation = await YoutubeAutomation.findOne({ user: userId }).populate({
      path: 'user',
      select: '+youtube.accessToken +youtube.refreshToken'
    });
    if (!automation) throw new Error('Automation settings not found');

    const pending = automation.pendingComments.find(c => c.commentId === commentId);
    if (!pending) throw new Error('Comment not found in pending list');

    const user = automation.user;
    const provider = new YoutubeProvider(
      user.youtube.accessToken,
      user.youtube.refreshToken,
      user.youtube.tokenExpiry,
      user.youtube.channelId
    );

    // Refresh token if needed
    if (new Date(user.youtube.tokenExpiry) <= new Date()) {
      await provider.refreshYouTubeToken(user._id);
    }

    const replyText = customReply || pending.aiSuggestedReply;
    let success;
    try {
      success = await provider.replyToCommentThread(commentId, replyText);
    } catch (err) {
      if (err.message === 'TOKEN_EXPIRED') {
        logger.info(`[YouTube Automation] Token expired during manual approval for ${user.email}, refreshing and retrying...`);
        const refreshed = await provider.refreshYouTubeToken(user._id);
        provider.accessToken = refreshed.accessToken;
        success = await provider.replyToCommentThread(commentId, replyText);
      } else {
        throw err;
      }
    }

    if (success) {
      automation.repliedCommentIds.push(commentId);
      pending.status = 'replied';
      // Keep in list or remove? Let's keep and mark as replied for history, but maybe limit list size.
      if (automation.pendingComments.length > 100) automation.pendingComments.shift();
      await automation.save();
      return true;
    }
    return false;
  }
}

module.exports = YoutubeAutomationService;
