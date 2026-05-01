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
   * Publish content to Instagram (Post, Reel, or Story)
   * @param {Object} params
   * @param {string} params.caption - The caption for the post
   * @param {string[]} params.mediaUrls - Array of media URLs
   * @param {string} params.type - 'post', 'reel', 'story'
   */
  /**
   * Publish content to Instagram (Post, Reel, or Story)
   * @param {Object} params
   * @param {string} params.caption - The caption for the post
   * @param {string[]} params.mediaUrls - Array of media URLs
   * @param {string} params.type - 'post', 'reel', 'story', 'carousel'
   */
  async publishPost(params) {
    const { caption, mediaUrls, type = 'post' } = params;
    try {
      if (!this.igAccountId) {
        throw new Error('Instagram Account ID is missing');
      }

      if (!mediaUrls || mediaUrls.length === 0) {
        throw new Error('No media URLs provided');
      }

      // Handle Carousel
      if (type === 'carousel' || mediaUrls.length > 1) {
        return await this._publishCarousel(caption, mediaUrls);
      }

      const mediaUrl = mediaUrls[0];
      if (!mediaUrl || mediaUrl === 'placeholder_media_url_for_now') {
        logger.info('Skipping actual Instagram API call due to placeholder media');
        return { success: true, message: 'Instagram post simulated', platform: 'instagram' };
      }

      const isVideo = mediaUrl.match(/\.(mp4|mov|avi|wmv)$/i) || type === 'reel';
      
      // 1. Create Media Container
      const containerData = {
        caption: caption,
      };

      if (type === 'reel') {
        containerData.media_type = 'REELS';
        containerData.video_url = mediaUrl;
      } else if (type === 'story') {
        containerData.media_type = 'STORIES';
        if (isVideo) containerData.video_url = mediaUrl;
        else containerData.image_url = mediaUrl;
      } else {
        // Regular Post
        if (isVideo) {
          containerData.media_type = 'VIDEO';
          containerData.video_url = mediaUrl;
        } else {
          containerData.image_url = mediaUrl;
        }
      }

      logger.info(`Creating Instagram ${type} container...`);
      const containerResponse = await axios.post(
        `${this.baseUrl}/${this.igAccountId}/media`,
        containerData,
        { params: { access_token: this.accessToken } }
      );

      const creationId = containerResponse.data.id;

      // 2. Poll for status if it's a video/reel/story
      if (isVideo || type === 'reel' || type === 'story') {
        logger.info(`Polling for Instagram ${type} container status (${creationId})...`);
        await this._waitForMediaProcessing(creationId);
      }

      // 3. Publish Media Container
      logger.info(`Publishing Instagram ${type} (${creationId})...`);
      const publishResponse = await axios.post(
        `${this.baseUrl}/${this.igAccountId}/media_publish`,
        { creation_id: creationId },
        { params: { access_token: this.accessToken } }
      );

      return {
        success: true,
        id: publishResponse.data.id,
        platform: 'instagram',
        type
      };
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Instagram publishPost error: ${errDetail}`);
      throw new Error(`Instagram API error: ${errDetail}`);
    }
  }

  /**
   * Publish a carousel (multi-image/video post)
   */
  async _publishCarousel(caption, mediaUrls) {
    try {
      const itemIds = [];

      // 1. Create children containers
      for (const url of mediaUrls) {
        const isVideo = url.match(/\.(mp4|mov|avi|wmv)$/i);
        const childData = {
          is_carousel_item: true,
        };

        if (isVideo) {
          childData.media_type = 'VIDEO';
          childData.video_url = url;
        } else {
          childData.image_url = url;
        }

        const childRes = await axios.post(
          `${this.baseUrl}/${this.igAccountId}/media`,
          childData,
          { params: { access_token: this.accessToken } }
        );
        itemIds.push(childRes.data.id);
      }

      // 2. Wait for all items to be processed
      for (const id of itemIds) {
        await this._waitForMediaProcessing(id);
      }

      // 3. Create Carousel Container
      const carouselRes = await axios.post(
        `${this.baseUrl}/${this.igAccountId}/media`,
        {
          media_type: 'CAROUSEL',
          caption: caption,
          children: itemIds.join(','),
        },
        { params: { access_token: this.accessToken } }
      );

      const creationId = carouselRes.data.id;

      // 4. Publish Carousel
      const publishRes = await axios.post(
        `${this.baseUrl}/${this.igAccountId}/media_publish`,
        { creation_id: creationId },
        { params: { access_token: this.accessToken } }
      );

      return {
        success: true,
        id: publishRes.data.id,
        platform: 'instagram',
        type: 'carousel'
      };
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Instagram _publishCarousel error: ${errDetail}`);
      throw new Error(`Instagram Carousel error: ${errDetail}`);
    }
  }

  /**
   * Wait for media to be processed by Instagram
   */
  async _waitForMediaProcessing(creationId, maxRetries = 15) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await axios.get(`${this.baseUrl}/${creationId}`, {
          params: {
            fields: 'status_code,status',
            access_token: this.accessToken
          }
        });

        const status = response.data.status_code;
        if (status === 'FINISHED') {
          return true;
        } else if (status === 'ERROR') {
          throw new Error(`Media processing failed: ${response.data.status || 'Unknown error'}`);
        }
        
        logger.info(`Container ${creationId} status: ${status}. Retrying in 5s...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        if (error.message.includes('Media processing failed')) throw error;
        logger.warn(`Polling error (retry ${i}): ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    throw new Error('Media processing timed out after 75 seconds. The post might still go live eventually.');
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

