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
   * Validates the access token before publishing
   * Call: GET /me?access_token=TOKEN
   */
  async validateToken() {
    try {
      logger.info(`[Facebook] Validating token for Page ID: ${this.pageId}`);
      const response = await axios.get(`${this.baseUrl}/me`, {
        params: { access_token: this.accessToken, fields: 'id,name' }
      });
      logger.info(`[Facebook] Token Validation SUCCESS for ${response.data.name} (ID: ${response.data.id})`);
      return { valid: true, data: response.data };
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`[Facebook] Token Validation FAILED for Page ID: ${this.pageId}. Response: ${errDetail}`);
      return { valid: false, error: errDetail };
    }
  }

  /**
   * Robust publishing function that handles validation and selective endpoint selection
   * @param {Object} account - The Facebook account object/metadata
   * @param {Object} content - { text, mediaUrls, type }
   */
  async publishToFacebook(account, content) {
    logger.info(`[Facebook] Starting robust publish process. Page: ${this.pageId}, Name: ${account.name || 'Unknown'}`);
    logger.info(`[Facebook] Content Type: ${content.type}, Media Count: ${content.mediaUrls?.length || 0}`);
    
    // 1. Token Validation
    const validation = await this.validateToken();
    if (!validation.valid) {
      logger.error(`[Facebook] Publishing aborted: Token is invalid for Page ${this.pageId}`);
      throw new Error(`Your account session expired. Please reconnect this platform. (Details: ${validation.error})`);
    }

    // 2. Select Endpoint & Publish
    logger.info(`[Facebook] Token validated. Proceeding to publishPost...`);
    const result = await this.publishPost(content.text, content.mediaUrls, content.type);
    
    logger.info(`[Facebook] Final Publish Response: ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * Publish a post to the Facebook Page feed
   * @param {string} message - The caption/text of the post
   * @param {string[]} mediaUrls - Array of media URLs
   * @param {string} type - 'post', 'reel', 'story'
   */
  async publishPost(message, mediaUrls = [], type = 'post') {
    try {
      const endpointBase = `${this.baseUrl}/${this.pageId}`;
      let result;

      if (type === 'story') {
        const storyMediaUrl = mediaUrls[0];
        const isStoryVideo = storyMediaUrl && (
          storyMediaUrl.match(/\.(mp4|mov|avi|wmv|m4v|webm|flv|3gp|mkv)/i) || 
          (typeof storyMediaUrl === 'string' && storyMediaUrl.includes('/video/upload/'))
        );
        
        // Facebook Stories API for Pages (Note: Requires specific permissions)
        const storyEndpoint = isStoryVideo ? `${endpointBase}/video_stories` : `${endpointBase}/photo_stories`;
        const storyData = isStoryVideo ? { video_url: storyMediaUrl } : { url: storyMediaUrl };
        
        logger.info(`[Facebook] Attempting Page Story publish. Endpoint: ${storyEndpoint}`);
        
        try {
          const response = await axios.post(storyEndpoint, storyData, {
            params: { access_token: this.accessToken },
          });
          
          result = {
            success: true,
            id: response.data.id || response.data.post_id || response.data.video_id,
            platform: 'facebook',
            type: 'story',
            endpoint: storyEndpoint,
            tokenType: 'page'
          };
        } catch (storyErr) {
          const errDetail = storyErr.response?.data ? JSON.stringify(storyErr.response.data) : storyErr.message;
          logger.warn(`[Facebook] Page Story API failed: ${errDetail}. Falling back to normal Page post.`);
          // Fallback to normal post as requested
          result = await this._publishNormal(message, mediaUrls, 'post');
        }
      } else if (type === 'carousel' || (mediaUrls && mediaUrls.length > 1)) {
        result = await this._publishCarousel(message, mediaUrls);
      } else {
        result = await this._publishNormal(message, mediaUrls, type);
      }

      return result;
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`[Facebook] publishPost FATAL error: ${errDetail}`);
      throw new Error(`Facebook API error: ${errDetail}`);
    }
  }

  async _publishNormal(message, mediaUrls = [], type = 'post') {
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
        endpoint = `${this.baseUrl}/${this.pageId}/videos`;
        data = {
          description: message,
          file_url: mediaUrl
        };
        logger.info(`Publishing video to Facebook: ${mediaUrl} to ${endpoint}`);
      } else {
        endpoint = `${this.baseUrl}/${this.pageId}/photos`;
        data = {
          caption: message,
          url: mediaUrl
        };
        logger.info(`Publishing photo to Facebook: ${mediaUrl} to ${endpoint}`);
      }
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
      type: isVideo ? 'video' : (mediaUrl ? 'photo' : 'text'),
      endpoint: endpoint
    };
  }

  async _publishCarousel(message, mediaUrls) {
    try {
      logger.info(`Publishing carousel to Facebook Page: ${this.pageId}. MediaCount: ${mediaUrls.length}`);
      const attachedMedia = [];
      for (const url of mediaUrls) {
        const isVideo = url.match(/\.(mp4|mov|avi|wmv|m4v|webm|flv|3gp|mkv)/i);
        if (isVideo) {
          throw new Error('Facebook Graph API currently does not easily support mixing videos in carousels. Please use only images for Facebook carousels.');
        }
        
        const photoRes = await axios.post(
          `${this.baseUrl}/${this.pageId}/photos`,
          {
            url: url,
            published: false
          },
          { params: { access_token: this.accessToken } }
        );
        attachedMedia.push({ media_fbid: photoRes.data.id });
      }

      const response = await axios.post(
        `${this.baseUrl}/${this.pageId}/feed`,
        {
          message: message,
          attached_media: attachedMedia
        },
        { params: { access_token: this.accessToken } }
      );

      return {
        success: true,
        id: response.data.id,
        platform: 'facebook',
        type: 'carousel',
        endpoint: `${this.baseUrl}/${this.pageId}/feed`
      };
    } catch (error) {
      const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`Facebook _publishCarousel error: ${errDetail}`);
      throw new Error(`Facebook Carousel error: ${errDetail}`);
    }
  }

  async updateProfile(name, description) {
    try {
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
