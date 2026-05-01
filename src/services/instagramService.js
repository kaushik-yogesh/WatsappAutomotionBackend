const axios = require('axios');
const logger = require('../utils/logger');

class InstagramService {
  constructor(pageAccessToken, pageId, igAccountId) {
    this.accessToken = pageAccessToken;
    this.pageId = pageId;
    this.igAccountId = igAccountId;
    this.apiVersion = process.env.META_API_VERSION || 'v19.0';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  /**
   * Publish a post to Instagram
   * @param {string} caption - The caption for the post
   * @param {string[]} mediaUrls - Array of media URLs
   */
  async publishPost(caption, mediaUrls = []) {
    try {
      if (!this.igAccountId) {
        throw new Error('Instagram Account ID is missing');
      }

      // 1. Create Media Container (assuming image for now)
      // Note: Instagram requires a public URL for media. 
      // If mediaUrl is a placeholder, we'll skip the actual API call and simulate success.
      const mediaUrl = mediaUrls[0];
      if (!mediaUrl || mediaUrl === 'placeholder_media_url_for_now') {
        logger.info('Skipping actual Instagram API call due to placeholder media');
        return { success: true, message: 'Instagram post simulated (placeholder media)', platform: 'instagram' };
      }

      const containerResponse = await axios.post(
        `${this.baseUrl}/${this.igAccountId}/media`,
        {
          image_url: mediaUrl,
          caption: caption
        },
        { params: { access_token: this.accessToken } }
      );

      const creationId = containerResponse.data.id;

      // 2. Publish Media Container
      const publishResponse = await axios.post(
        `${this.baseUrl}/${this.igAccountId}/media_publish`,
        { creation_id: creationId },
        { params: { access_token: this.accessToken } }
      );

      return {
        success: true,
        id: publishResponse.data.id,
        platform: 'instagram'
      };
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Instagram publishPost error: ${errDetail}`);
      throw new Error(`Instagram API error: ${errDetail}`);
    }
  }

  async sendTextMessage(igAccountId, recipientId, text) {
    try {
      // Must use 'me' or pageId, because igAccountId throws "Application does not have the capability to make this API call"
      const endpointId = 'me';
      const response = await axios.post(
        `${this.baseUrl}/${endpointId}/messages`,
        {
          messaging_type: 'RESPONSE',
          recipient: { id: recipientId },
          message: { text },
        },
        {
          params: { access_token: this.accessToken },
        }
      );
      return response.data;
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Instagram sendTextMessage error: ${errDetail}`);
      throw error;
    }
  }

  async replyToComment(igAccountId, commentId, text) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/${commentId}/replies`,
        { message: text },
        { params: { access_token: this.accessToken } }
      );
      return response.data;
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Instagram replyToComment error: ${errDetail}`);
      throw error;
    }
  }

  async resolveMessageSender(messageId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${messageId}`,
        {
          params: {
            fields: 'from,to,message',
            access_token: this.accessToken,
          },
        }
      );
      return response.data;
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Instagram resolveMessageSender error: ${errDetail}`);
      return null;
    }
  }

  async getCustomerProfile(igScopedId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${igScopedId}`,
        {
          params: {
            fields: 'name,username,profile_pic',
            access_token: this.accessToken,
          },
        }
      );
      return response.data;
    } catch (error) {
      logger.error(`Instagram getCustomerProfile error: ${error.message}`);
      return null;
    }
  }
}

module.exports = InstagramService;
