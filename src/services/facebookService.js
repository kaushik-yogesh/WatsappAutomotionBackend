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
   * Send a text message to a user on Messenger
   */
  async sendTextMessage(recipientId, text) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/me/messages`,
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
      logger.error(`Facebook sendTextMessage error: ${errDetail}`);
      throw error;
    }
  }

  /**
   * Get customer profile from Messenger PSID
   */
  async getCustomerProfile(psid) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${psid}`,
        {
          params: {
            fields: 'first_name,last_name,profile_pic,name',
            access_token: this.accessToken,
          },
        }
      );
      return response.data;
    } catch (error) {
      logger.error(`Facebook getCustomerProfile error: ${error.message}`);
      return null;
    }
  }

  /**
   * Mark message as seen
   */
  async sendAction(recipientId, action = 'mark_seen') {
    try {
      await axios.post(
        `${this.baseUrl}/me/messages`,
        {
          recipient: { id: recipientId },
          sender_action: action, // mark_seen, typing_on, typing_off
        },
        {
          params: { access_token: this.accessToken },
        }
      );
    } catch (error) {
      logger.error(`Facebook sendAction error: ${error.message}`);
    }
  }
}

module.exports = FacebookService;
