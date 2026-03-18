const axios = require('axios');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const META_API_BASE = `https://graph.facebook.com/${process.env.META_API_VERSION}`;

class WhatsAppService {
  constructor(accessToken, phoneNumberId) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.client = axios.create({
      baseURL: META_API_BASE,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  // Send text message
  async sendTextMessage(to, text) {
    try {
      const response = await this.client.post(`/${this.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      });
      return response.data;
    } catch (err) {
      logger.error('WhatsApp sendTextMessage error:', err.response?.data || err.message);
      throw new AppError('Failed to send WhatsApp message.', 502);
    }
  }

  // Send template message
  async sendTemplateMessage(to, templateName, languageCode = 'en_US', components = []) {
    try {
      const response = await this.client.post(`/${this.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: languageCode }, components },
      });
      return response.data;
    } catch (err) {
      logger.error('WhatsApp sendTemplateMessage error:', err.response?.data || err.message);
      throw new AppError('Failed to send template message.', 502);
    }
  }

  // Send interactive button message
  async sendButtonMessage(to, bodyText, buttons) {
    try {
      const response = await this.client.post(`/${this.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: buttons.map((b, i) => ({
              type: 'reply',
              reply: { id: `btn_${i}`, title: b },
            })),
          },
        },
      });
      return response.data;
    } catch (err) {
      logger.error('WhatsApp sendButtonMessage error:', err.response?.data || err.message);
      throw new AppError('Failed to send button message.', 502);
    }
  }

  // Mark message as read
  async markAsRead(messageId) {
    try {
      await this.client.post(`/${this.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });
    } catch (err) {
      logger.warn('Mark as read failed:', err.message);
    }
  }

  // Get phone number info
  async getPhoneNumberInfo() {
    try {
      const response = await this.client.get(`/${this.phoneNumberId}`, {
        params: { fields: 'verified_name,display_phone_number,quality_rating,status' },
      });
      return response.data;
    } catch (err) {
      const metaError = err.response?.data?.error;
      const detail = metaError
        ? `Meta error ${metaError.code}: ${metaError.message}`
        : err.message;
      logger.error(`Get phone info error [phoneNumberId=${this.phoneNumberId}]: ${detail}`);

      // Throw descriptive error so caller can decide how to handle
      const userMsg = metaError?.code === 190
        ? 'Access Token is invalid or expired. Generate a new one from Meta Developer Console.'
        : metaError?.code === 100
          ? 'Phone Number ID is incorrect. Check it in Meta API Setup.'
          : `Meta API error: ${detail}`;

      throw new AppError(userMsg, 502);
    }
  }

  // Verify webhook token
  static verifyWebhook(mode, token, challenge) {
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      return challenge;
    }
    throw new AppError('Webhook verification failed.', 403);
  }

  // Parse incoming webhook message
  static parseWebhookMessage(body) {
    try {
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value?.messages?.[0]) return null;

      const message = value.messages[0];
      const contact = value.contacts?.[0];
      const metadata = value.metadata;

      return {
        phoneNumberId: metadata?.phone_number_id,
        wabaId: entry?.id,
        messageId: message.id,
        from: message.from,
        customerName: contact?.profile?.name || 'Unknown',
        timestamp: message.timestamp,
        type: message.type,
        text: message.type === 'text' ? message.text?.body : null,
        imageId: message.type === 'image' ? message.image?.id : null,
        audioId: message.type === 'audio' ? message.audio?.id : null,
        documentId: message.type === 'document' ? message.document?.id : null,
        buttonReply: message.type === 'interactive' ? message.interactive?.button_reply : null,
        location: message.type === 'location' ? message.location : null,
      };
    } catch (err) {
      logger.error('Parse webhook error:', err);
      return null;
    }
  }
}

module.exports = WhatsAppService;