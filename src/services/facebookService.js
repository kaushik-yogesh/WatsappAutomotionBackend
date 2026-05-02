const axios = require('axios');
const logger = require('../utils/logger');

class FacebookService {
  constructor(pageAccessToken, pageId) {
    this.accessToken = pageAccessToken;
    this.pageId = pageId;
    this.apiVersion = process.env.META_API_VERSION || 'v19.0';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  /**
   * Publish a post to the Facebook Page feed
   * @param {string} message - The caption/text of the post
   * @param {string[]} mediaUrls - Array of media URLs
   * @param {string} type - 'post', 'reel', 'story'
   */
  async publishPost(message, mediaUrls = [], type = 'post') {
    try {
      if (type === 'story') {
        throw new Error('Facebook Story publishing is not supported in current integration.');
      }
      const mediaUrl = mediaUrls[0];
      
      // Robust video detection
      const isVideo = mediaUrl && (
        mediaUrl.match(/\.(mp4|mov|avi|wmv|m4v|webm|flv|3gp|mkv)/i) || 
        type === 'reel' || 
        (typeof mediaUrl === 'string' && mediaUrl.includes('/video/upload/'))
      );

      let endpoint = `${this.baseUrl}/${this.pageId}/feed`;
      let data = { message };

      if (mediaUrl && mediaUrl !== 'placeholder_media_url_for_now') {
        if (isVideo) {
          // Posting a video
          endpoint = `${this.baseUrl}/${this.pageId}/videos`;
          data = {
            description: message,
            file_url: mediaUrl
          };
          logger.info(`Publishing video to Facebook: ${mediaUrl}`);
        } else {
          // Posting a photo
          endpoint = `${this.baseUrl}/${this.pageId}/photos`;
          data = {
            caption: message,
            url: mediaUrl
          };
          logger.info(`Publishing photo to Facebook: ${mediaUrl}`);
        }
      } else {
        logger.info(`Publishing text-only post to Facebook`);
      }

      const response = await axios.post(
        endpoint,
        data,
        {
          params: { access_token: this.accessToken },
        }
      );
      
      return {
        success: true,
        id: response.data.id || response.data.post_id,
        platform: 'facebook',
        type: isVideo ? 'video' : (mediaUrl ? 'photo' : 'text')
      };
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Facebook publishPost error: ${errDetail}`);
      throw new Error(`Facebook API error: ${errDetail}`);
    }
  }

  async updateProfile(name, description) {
    try {
      // Note: Updating page name requires special permissions, but updating description (about) is easier
      const response = await axios.post(
        `${this.baseUrl}/${this.pageId}`,
        { about: description },
        { params: { access_token: this.accessToken } }
      );
      return response.data;
    } catch (error) {
      logger.error(`Facebook updateProfile error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get recent posts for the Facebook Page
   */
  async getMedia() {
    try {
      // Using a minimal set of fields to avoid 'deprecate_post_aggregated_fields_for_attachement' error
      const response = await axios.get(`${this.baseUrl}/${this.pageId}/feed`, {
        params: {
          fields: 'id,message,attachments,permalink_url,created_time',
          access_token: this.accessToken
        }
      });
      return response.data.data;
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Facebook getMedia error: ${errDetail}`);
      throw new Error(`Facebook API error: ${errDetail}`);
    }
  }

  /**
   * Delete a post
   */
  async deleteMedia(postId) {
    try {
      const response = await axios.delete(`${this.baseUrl}/${postId}`, {
        params: { access_token: this.accessToken }
      });
      return response.data;
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Facebook deleteMedia error: ${errDetail}`);
      throw new Error(`Facebook API error: ${errDetail}`);
    }
  }
}

module.exports = FacebookService;
