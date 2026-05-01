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
   */
  async publishPost(message, mediaUrls = []) {
    try {
      const mediaUrl = mediaUrls[0];
      const isVideo = mediaUrl && mediaUrl.match(/\.(mp4|mov|avi|wmv)$/i);

      let endpoint = `${this.baseUrl}/${this.pageId}/feed`;
      let data = { message };

      if (mediaUrl && mediaUrl !== 'placeholder_media_url_for_now') {
        if (isVideo) {
          endpoint = `${this.baseUrl}/${this.pageId}/videos`;
          data = {
            description: message,
            file_url: mediaUrl // Use file_url for public URLs
          };
        } else {
          endpoint = `${this.baseUrl}/${this.pageId}/photos`;
          data = {
            caption: message,
            url: mediaUrl
          };
        }
      }

      logger.info(`Publishing to Facebook... Endpoint: ${endpoint}`);
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
        platform: 'facebook'
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
}

module.exports = FacebookService;
