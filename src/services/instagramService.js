const axios = require('axios');
const logger = require('../utils/logger');

class InstagramService {
  constructor(pageAccessToken) {
    this.accessToken = pageAccessToken;
    this.apiVersion = process.env.META_API_VERSION || 'v19.0';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  async sendTextMessage(igAccountId, recipientId, text) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/${igAccountId}/messages`,
        {
          recipient: { id: recipientId },
          message: { text },
        },
        {
          params: { access_token: this.accessToken },
        }
      );
      return response.data;
    } catch (error) {
      logger.error('Instagram sendTextMessage error:', error.response?.data || error.message);
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
      logger.error('Instagram replyToComment error:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = InstagramService;
