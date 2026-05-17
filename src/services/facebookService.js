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

  /**
   * Publish content to a Facebook Page (feed, photos, videos, or multi-photo)
   */
  async publishToFacebook(config, { text, mediaUrls = [], type }) {
    try {
      logger.info(`Publishing to Facebook Page ${this.pageId}. Type: ${type}, Media count: ${mediaUrls.length}`);

      // 1. Video post
      const isVideo = mediaUrls.some(url => /\.(mp4|mov|avi|wmv|m4v|webm)$/i.test(url));
      if (isVideo) {
        const videoUrl = mediaUrls.find(url => /\.(mp4|mov|avi|wmv|m4v|webm)$/i.test(url));
        const res = await axios.post(
          `${this.baseUrl}/${this.pageId}/videos`,
          {
            description: text,
            file_url: videoUrl,
          },
          {
            params: { access_token: this.accessToken },
          }
        );
        return { id: res.data.id || res.data.video_id };
      }

      // 2. Multi-photo post
      if (mediaUrls.length > 1) {
        // Upload each photo individually as unpublished
        const photoIds = [];
        for (const url of mediaUrls) {
          const uploadRes = await axios.post(
            `${this.baseUrl}/${this.pageId}/photos`,
            {
              url,
              published: false,
            },
            {
              params: { access_token: this.accessToken },
            }
          );
          if (uploadRes.data && uploadRes.data.id) {
            photoIds.push(uploadRes.data.id);
          }
        }

        // Post them together as a multi-photo post to feed
        const attachedMedia = photoIds.map(id => ({ media_fbid: id }));
        const feedRes = await axios.post(
          `${this.baseUrl}/${this.pageId}/feed`,
          {
            message: text,
            attached_media: attachedMedia,
          },
          {
            params: { access_token: this.accessToken },
          }
        );
        return { id: feedRes.data.id };
      }

      // 3. Single photo post
      if (mediaUrls.length === 1) {
        const res = await axios.post(
          `${this.baseUrl}/${this.pageId}/photos`,
          {
            url: mediaUrls[0],
            caption: text,
          },
          {
            params: { access_token: this.accessToken },
          }
        );
        return { id: res.data.id || res.data.post_id };
      }

      // 4. Text-only post
      const res = await axios.post(
        `${this.baseUrl}/${this.pageId}/feed`,
        {
          message: text,
        },
        {
          params: { access_token: this.accessToken },
        }
      );
      return { id: res.data.id };
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Facebook publishToFacebook error: ${errDetail}`);
      throw error;
    }
  }
}

module.exports = FacebookService;
