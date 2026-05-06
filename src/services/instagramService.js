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
  /**
   * Publish content to Instagram (Post, Reel, Story, or Carousel)
   * Mandatory: Container creation -> Status polling -> Publish after FINISHED
   */
  async publishPost(params) {
    const { caption, mediaUrls, type = 'post' } = params;
    try {
      if (!this.igAccountId) {
        throw new Error('Instagram Account ID is missing. Story and Business publishing requires a linked IG account.');
      }

      // Filter and validate media URLs
      const validMediaUrls = (mediaUrls || []).filter(url => url && typeof url === 'string' && url.trim() !== '' && url !== 'placeholder_media_url_for_now');
      
      if (validMediaUrls.length === 0) {
        throw new Error('Instagram requires at least one valid image or video URL.');
      }

      // Handle Carousel (Multiple media items)
      if (type === 'carousel' || validMediaUrls.length > 1) {
        return await this._publishCarousel(caption, validMediaUrls);
      }

      const mediaUrl = validMediaUrls[0];
      const isVideo = mediaUrl.match(/\.(mp4|mov|avi|wmv|m4v|webm|flv|3gp|mkv)(?:\?|$)/i) || mediaUrl.includes('/video/') || type === 'reel';
      
      // 1. Create Media Container
      const containerData = { caption };

      if (type === 'reel') {
        containerData.media_type = 'REELS';
        containerData.video_url = mediaUrl;
        containerData.share_to_feed = true; // Essential for Reel visibility
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

      logger.info(`[Instagram] Creating ${type} container...`);
      const containerResponse = await axios.post(
        `${this.baseUrl}/${this.igAccountId}/media`,
        containerData,
        { params: { access_token: this.accessToken } }
      );

      const creationId = containerResponse.data.id;
      if (!creationId) throw new Error('Instagram failed to return a Container ID.');

      // 2. Poll for FINISHED status
      await this._waitForMediaProcessing(creationId);

      // 3. Publish Media Container
      logger.info(`[Instagram] Publishing ${type} container ${creationId}...`);
      const publishResponse = await axios.post(
        `${this.baseUrl}/${this.igAccountId}/media_publish`,
        { creation_id: creationId },
        { params: { access_token: this.accessToken } }
      );

      if (!publishResponse.data.id) throw new Error('Instagram failed to return a Media ID after publishing.');

      return {
        success: true,
        id: publishResponse.data.id,
        platform: 'instagram',
        type
      };
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`[Instagram] publishPost fatal error: ${errDetail}`);
      throw new Error(`Instagram API error: ${errDetail}`);
    }
  }

  /**
   * Publish a carousel (multi-media post)
   * Flow: Create children -> Poll children -> Create carousel container -> Poll carousel container -> Publish
   */
  async _publishCarousel(caption, mediaUrls) {
    try {
      const itemIds = [];

      // 1. Create children containers
      for (const url of mediaUrls) {
        const isVideo = url.match(/\.(mp4|mov|avi|wmv|m4v|webm|flv|3gp|mkv)(?:\?|$)/i) || url.includes('/video/');
        const childData = { is_carousel_item: true };

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
        if (childRes.data.id) itemIds.push(childRes.data.id);
      }

      // 2. Wait for all children to be FINISHED
      for (const id of itemIds) {
        await this._waitForMediaProcessing(id);
      }

      // 3. Create Carousel (Master) Container
      logger.info(`[Instagram] Creating carousel master container for ${itemIds.length} items...`);
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
      if (!creationId) throw new Error('Instagram failed to return a Carousel Container ID.');

      // 4. MUST poll the carousel container itself before publishing
      await this._waitForMediaProcessing(creationId);

      // 5. Publish Carousel
      logger.info(`[Instagram] Publishing carousel master ${creationId}...`);
      const publishRes = await axios.post(
        `${this.baseUrl}/${this.igAccountId}/media_publish`,
        { creation_id: creationId },
        { params: { access_token: this.accessToken } }
      );

      if (!publishRes.data.id) throw new Error('Instagram failed to return a Media ID after carousel publishing.');

      return {
        success: true,
        id: publishRes.data.id,
        platform: 'instagram',
        type: 'carousel'
      };
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`[Instagram] _publishCarousel fatal error: ${errDetail}`);
      throw new Error(`Instagram Carousel error: ${errDetail}`);
    }
  }

  /**
   * Strict Polling Manager for Instagram Media Container Processing
   * States: queued, processing, finished, failed, expired
   */
  async _waitForMediaProcessing(creationId) {
    const intervals = [3000, 5000, 8000, 13000, 21000]; // Fibonacci-based backoff
    let currentState = 'queued';

    for (let i = 0; i < intervals.length; i++) {
      const waitTime = intervals[i];
      logger.info(`[Instagram] Polling container ${creationId}. State: ${currentState}. Next poll in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));

      try {
        const response = await axios.get(`${this.baseUrl}/${creationId}`, {
          params: {
            fields: 'status_code,status',
            access_token: this.accessToken
          }
        });

        const statusCode = response.data.status_code;
        
        // Map Instagram states to requested logic
        if (statusCode === 'FINISHED') {
          logger.info(`[Instagram] Media processing FINISHED for container ${creationId}`);
          return { state: 'finished', id: creationId };
        }

        if (statusCode === 'ERROR') {
          logger.error(`[Instagram] Media processing FAILED for container ${creationId}: ${response.data.status}`);
          throw new Error(`Media processing failed: ${response.data.status || 'Unknown error'}`);
        }

        if (statusCode === 'EXPIRED') {
          logger.warn(`[Instagram] Media processing EXPIRED for container ${creationId}`);
          throw new Error('Media processing expired. Container is no longer valid.');
        }

        // Default to processing state
        currentState = 'processing';
        
      } catch (error) {
        if (error.message.includes('failed') || error.message.includes('expired')) throw error;
        logger.warn(`[Instagram] Polling transient error for ${creationId}: ${error.message}`);
      }
    }

    // Mark as failed on timeout
    logger.error(`[Instagram] Media processing TIMEOUT for container ${creationId} after multiple attempts.`);
    throw new Error('Media processing failed: Timeout reached during processing.');
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

  /**
   * Get recent media for the Instagram Business Account
   */
  async getMedia() {
    try {
      const response = await axios.get(`${this.baseUrl}/${this.igAccountId}/media`, {
        params: {
          fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp',
          access_token: this.accessToken
        }
      });
      return response.data.data;
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Instagram getMedia error: ${errDetail}`);
      throw new Error(`Instagram API error: ${errDetail}`);
    }
  }

  /**
   * Delete a media item
   */
  async deleteMedia(mediaId) {
    try {
      // Instagram Graph API doesn't support deleting media directly via API for business accounts easily
      // However, for some cases it might work if the app has the right permissions.
      // But usually, it's not supported for business accounts via Graph API.
      // Wait, let's check. Actually, it is NOT supported.
      // "Instagram media cannot be deleted via the API."
      // BUT, we can try. Some newer versions might have it or for certain types.
      // Actually, standard Instagram Graph API DOES NOT allow deletion.
      // I will implement it as a "not supported" message or try and catch.
      
      // Let's assume for this SaaS we want to TRY if possible or at least provide the placeholder.
      // NOTE: Facebook posts CAN be deleted.
      
      throw new Error('Instagram does not allow deleting posts via API. Please delete it directly from the Instagram app.');
    } catch (error) {
      throw error;
    }
  }
}

module.exports = InstagramService;

