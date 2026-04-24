const axios = require('axios');
const logger = require('../utils/logger');

class TelegramService {
  constructor(botToken) {
    this.botToken = botToken;
    this.apiUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendTextMessage(chatId, text) {
    try {
      const response = await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: chatId,
        text: text,
      });
      return response.data;
    } catch (error) {
      logger.error('Error sending Telegram message:', error.response?.data || error.message);
      throw error;
    }
  }

  async setWebhook(url) {
    try {
      const response = await axios.post(`${this.apiUrl}/setWebhook`, {
        url: url,
      });
      return response.data;
    } catch (error) {
      logger.error('Error setting Telegram webhook:', error.response?.data || error.message);
      throw error;
    }
  }

  async getWebhookInfo() {
    try {
      const response = await axios.get(`${this.apiUrl}/getWebhookInfo`);
      return response.data;
    } catch (error) {
      logger.error('Error getting Telegram webhook info:', error.response?.data || error.message);
      throw error;
    }
  }
  
  async getMe() {
    try {
      const response = await axios.get(`${this.apiUrl}/getMe`);
      return response.data;
    } catch (error) {
      logger.error('Error getting Telegram bot info:', error.response?.data || error.message);
      throw error;
    }
  }

  static parseWebhookMessage(body) {
    if (body.message) {
      return {
        messageId: body.message.message_id,
        chatId: body.message.chat.id,
        fromId: body.message.from.id,
        fromName: body.message.from.first_name + (body.message.from.last_name ? ' ' + body.message.from.last_name : ''),
        fromUsername: body.message.from.username,
        text: body.message.text,
        timestamp: body.message.date,
      };
    }
    return null;
  }
}

module.exports = TelegramService;
