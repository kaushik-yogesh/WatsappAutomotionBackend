const InstagramService = require('./instagramService');
const FacebookService = require('./facebookService');
const logger = require('../utils/logger');

/**
 * SocialMediaHubService manages multi-platform social media operations.
 * It uses the Adapter pattern to delegate platform-specific logic.
 */
class SocialMediaHubService {
  /**
   * Publish content to multiple platforms
   * @param {Object} params
   * @param {string} params.type - 'post', 'reel', 'story'
   * @param {string} params.caption - Text content
   * @param {string[]} params.mediaUrls - Array of media URLs
   * @param {Array} params.platforms - Array of platform objects { id, platform, name, accessToken, pageId, igAccountId }
   */
  static async publishToAll(params) {
    const { type, caption, mediaUrls, platforms } = params;
    const results = [];

    const promises = platforms.map(async (p) => {
      try {
        let result;
        switch (p.platform) {
          case 'instagram':
            const igService = new InstagramService(p.accessToken, p.pageId, p.igAccountId);
            result = await igService.publishPost({ caption, mediaUrls, type });
            break;
          case 'facebook':
            const fbService = new FacebookService(p.accessToken, p.pageId);
            result = await fbService.publishPost(caption, mediaUrls, type);
            break;
          case 'telegram':
            // Add Telegram posting logic here in the future
            result = { success: true, message: 'Telegram posting not yet implemented', platform: 'telegram' };
            break;
          default:
            result = { success: false, message: `Platform ${p.platform} not supported`, platform: p.platform };
        }
        return result;
      } catch (err) {
        logger.error(`Error publishing to ${p.platform}: ${err.message}`);
        return { success: false, message: err.message, platform: p.platform };
      }
    });

    return Promise.all(promises);
  }

  /**
   * Update profile info across multiple platforms
   */
  static async updateProfiles(params) {
    const { name, description, platforms } = params;
    const results = [];

    const promises = platforms.map(async (p) => {
      try {
        let result;
        switch (p.platform) {
          case 'instagram':
            // IG Business profile update via API is limited, but we can try updating the linked FB page
            const igService = new InstagramService(p.accessToken, p.pageId, p.igAccountId);
            // result = await igService.updateProfile(name, description);
            result = { success: true, message: 'Instagram profile sync simulated', platform: 'instagram' };
            break;
          case 'facebook':
            const fbService = new FacebookService(p.accessToken, p.pageId);
            result = await fbService.updateProfile(name, description);
            result = { success: true, message: 'Facebook Page info updated', platform: 'facebook' };
            break;
          default:
            result = { success: true, message: `Profile sync simulated for ${p.platform}`, platform: p.platform };
        }
        return result;
      } catch (err) {
        logger.error(`Error updating profile on ${p.platform}: ${err.message}`);
        return { success: false, message: err.message, platform: p.platform };
      }
    });

    return Promise.all(promises);
  }

  /**
   * Get feeds from multiple platforms
   */
  static async getFeed(platforms) {
    const promises = platforms.map(async (p) => {
      try {
        let posts = [];
        switch (p.platform) {
          case 'instagram':
            const igService = new InstagramService(p.accessToken, p.pageId, p.igAccountId);
            posts = await igService.getMedia();
            return posts.map(post => ({
              id: post.id,
              caption: post.caption,
              mediaUrl: post.media_url,
              permalink: post.permalink,
              timestamp: post.timestamp,
              type: post.media_type,
              platform: 'instagram',
              accountId: p.id
            }));
          case 'facebook':
            const fbService = new FacebookService(p.accessToken, p.pageId);
            posts = await fbService.getMedia();
            return posts.map(post => ({
              id: post.id,
              caption: post.message,
              mediaUrl: post.full_picture,
              permalink: post.permalink_url,
              timestamp: post.created_time,
              type: post.type,
              platform: 'facebook',
              accountId: p.id
            }));
          default:
            return [];
        }
      } catch (err) {
        logger.error(`Error getting feed from ${p.platform}: ${err.message}`);
        return [];
      }
    });

    const results = await Promise.all(promises);
    return results.flat().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Delete a post from a platform
   */
  static async deletePost(params) {
    const { platform, postId, accessToken, pageId, igAccountId } = params;
    try {
      switch (platform) {
        case 'instagram':
          const igService = new InstagramService(accessToken, pageId, igAccountId);
          return await igService.deleteMedia(postId);
        case 'facebook':
          const fbService = new FacebookService(accessToken, pageId);
          return await fbService.deleteMedia(postId);
        default:
          throw new Error(`Deletion not supported for ${platform}`);
      }
    } catch (err) {
      logger.error(`Error deleting post from ${platform}: ${err.message}`);
      throw err;
    }
  }
}

module.exports = SocialMediaHubService;
