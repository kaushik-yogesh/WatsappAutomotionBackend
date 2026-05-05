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
        result = await this._publishStory(message, mediaUrls);
      } else if (type === 'reel') {
        result = await this._publishReel(message, mediaUrls[0]);
      } else if (type === 'carousel' || (mediaUrls && mediaUrls.length > 1)) {
        result = await this._publishCarousel(message, mediaUrls);
      } else {
        result = await this._publishNormal(message, mediaUrls, type);
      }

      // Strict Success Confirmation
      if (!result || !result.id) {
        throw new Error(`Facebook API returned a partial response. Post ID missing. Details: ${JSON.stringify(result)}`);
      }

      return result;
    } catch (error) {
      let errDetail;
      if (error.response?.data) {
        const d = error.response.data;
        // Handle ArrayBuffer or Buffer in error response
        if (Buffer.isBuffer(d) || d instanceof ArrayBuffer || d instanceof Uint8Array) {
          const buf = Buffer.from(d);
          errDetail = `HTTP ${error.response.status} — ${buf.toString('utf8') || '(empty response)'}`;
        } else if (typeof d === 'object') {
          errDetail = JSON.stringify(d);
        } else {
          errDetail = String(d);
        }
      } else {
        errDetail = error.message;
      }
      logger.error(`[Facebook] publishPost FATAL error: ${errDetail}`);
      throw new Error(`Facebook API error: ${errDetail}`);
    }
  }

  async _publishStory(message, mediaUrls) {
    const storyMediaUrl = mediaUrls[0];
    const isStoryVideo = storyMediaUrl && (
      storyMediaUrl.match(/\.(mp4|mov|avi|wmv|m4v|webm|flv|3gp|mkv)/i) || 
      (typeof storyMediaUrl === 'string' && storyMediaUrl.includes('/video/upload/'))
    );
    
    const storyEndpoint = isStoryVideo ? `${this.baseUrl}/${this.pageId}/video_stories` : `${this.baseUrl}/${this.pageId}/photo_stories`;
    const storyData = isStoryVideo ? { video_url: storyMediaUrl } : { url: storyMediaUrl };
    
    logger.info(`[Facebook] Attempting Page Story publish. Endpoint: ${storyEndpoint}`);
    
    const response = await axios.post(storyEndpoint, storyData, {
      params: { access_token: this.accessToken },
    });
    
    return {
      success: true,
      id: response.data.id || response.data.post_id || response.data.video_id,
      platform: 'facebook',
      type: 'story'
    };
  }

  async _publishReel(message, videoUrl) {
    logger.info(`[Facebook] Attempting Page Reel publish (Resumable Byte Upload). PageId: ${this.pageId}`);

    try {
      // Step 1: Initialize — get video_id + upload_url
      logger.info(`[Facebook] Reel Step 1: Initializing upload session (START)...`);
      const startRes = await axios.post(
        `${this.baseUrl}/${this.pageId}/video_reels`,
        { upload_phase: 'start' },
        { params: { access_token: this.accessToken } }
      ).catch(e => {
        logger.error(`[Facebook] Reel Step 1 (START) failed: ${e.message}`);
        throw e;
      });

      const videoId = startRes.data?.video_id;
      const uploadUrl = startRes.data?.upload_url;
      if (!videoId) {
        throw new Error(`Facebook Reel START failed — no video_id. Response: ${JSON.stringify(startRes.data)}`);
      }
      logger.info(`[Facebook] Reel Step 1 SUCCESS. video_id: ${videoId}`);

      // Step 2: Download video from source URL
      logger.info(`[Facebook] Reel Step 2: Downloading video from source: ${videoUrl}`);
      const videoResponse = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 120000, // Increased to 2 mins for large videos
        maxRedirects: 10,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
        },
      }).catch(e => {
        logger.error(`[Facebook] Reel Step 2 (Download) failed: ${e.message} (Code: ${e.code})`);
        throw e;
      });

      if (!videoResponse.data || (videoResponse.data.length === 0 && videoResponse.data.byteLength === 0)) {
        throw new Error(`Video download returned empty content. Status: ${videoResponse.status}`);
      }

      const videoBuffer = Buffer.from(videoResponse.data);
      const fileSize = videoBuffer.length;
      logger.info(`[Facebook] Reel Step 2 SUCCESS. Downloaded ${fileSize} bytes.`);

      // Step 3: Upload bytes to Facebook's upload_url
      logger.info(`[Facebook] Reel Step 3: Uploading bytes to Facebook...`);
      const targetUploadUrl = uploadUrl || `https://rupload.facebook.com/video-upload/v${this.apiVersion}/${videoId}`;
      await axios.post(targetUploadUrl, videoBuffer, {
        headers: {
          'Authorization': `OAuth ${this.accessToken}`,
          'offset': '0',
          'file_size': String(fileSize),
          'Content-Type': 'application/octet-stream',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 240000, // 4 mins for upload
      }).catch(e => {
        logger.error(`[Facebook] Reel Step 3 (Upload Bytes) failed: ${e.message}`);
        throw e;
      });
      logger.info(`[Facebook] Reel Step 3 SUCCESS. Video transferred.`);

      // Step 4: Finish & publish
      logger.info(`[Facebook] Reel Step 4: Finalizing publish (FINISH)...`);
      const finishRes = await axios.post(
        `${this.baseUrl}/${this.pageId}/video_reels`,
        {
          upload_phase: 'finish',
          video_id: videoId,
          video_state: 'PUBLISHED',
          description: message,
        },
        { params: { access_token: this.accessToken } }
      ).catch(e => {
        logger.error(`[Facebook] Reel Step 4 (FINISH) failed: ${e.message}`);
        throw e;
      });
      
      logger.info(`[Facebook] Reel Step 4 SUCCESS. Reel published.`);

      return {
        success: true,
        id: finishRes.data?.post_id || finishRes.data?.video_id || videoId,
        platform: 'facebook',
        type: 'reel'
      };
    } catch (err) {
      // Improved error message extraction
      let errMsg = '';
      if (err.response?.data) {
        const d = err.response.data;
        errMsg = (Buffer.isBuffer(d) || d instanceof ArrayBuffer) 
          ? Buffer.from(d).toString('utf8') 
          : JSON.stringify(d);
      } else {
        errMsg = err.message || err.code || 'Unknown network/internal error';
      }
      
      logger.error(`[Facebook] _publishReel FATAL flow failure: ${errMsg}`);
      if (err.stack) logger.error(err.stack);
      
      throw new Error(`Facebook Reel flow error: ${errMsg}`);
    }
  }

  async _publishNormal(message, mediaUrls = [], type = 'post') {
    const mediaUrl = mediaUrls[0];
    const isVideo = mediaUrl && (
      mediaUrl.match(/\.(mp4|mov|avi|wmv|m4v|webm|flv|3gp|mkv)/i) || 
      (typeof mediaUrl === 'string' && mediaUrl.includes('/video/upload/'))
    );

    let endpoint = `${this.baseUrl}/${this.pageId}/feed`;
    let data = { message };

    if (mediaUrl && mediaUrl !== 'placeholder_media_url_for_now') {
      if (isVideo) {
        endpoint = `${this.baseUrl}/${this.pageId}/videos`;
        data = { description: message, file_url: mediaUrl };
      } else {
        endpoint = `${this.baseUrl}/${this.pageId}/photos`;
        data = { caption: message, url: mediaUrl };
      }
    }

    const response = await axios.post(endpoint, data, {
      params: { access_token: this.accessToken },
    });
    
    return {
      success: true,
      id: response.data.id || response.data.post_id,
      platform: 'facebook',
      type: isVideo ? 'video' : (mediaUrl ? 'photo' : 'text')
    };
  }

  async _publishCarousel(message, mediaUrls) {
    logger.info(`[Facebook] Attempting Carousel Fallback (Multi-Photo Feed). Count: ${mediaUrls.length}`);
    const attachedMedia = [];
    
    for (const url of mediaUrls) {
      // Step 1: Upload photo as unpublished
      const photoRes = await axios.post(
        `${this.baseUrl}/${this.pageId}/photos`,
        { url: url, published: false },
        { params: { access_token: this.accessToken } }
      );
      
      if (!photoRes.data.id) throw new Error('Failed to upload individual media item for carousel.');
      attachedMedia.push({ media_fbid: photoRes.data.id });
    }

    // Step 2: Publish feed post with attached media IDs
    const response = await axios.post(
      `${this.baseUrl}/${this.pageId}/feed`,
      { message: message, attached_media: attachedMedia },
      { params: { access_token: this.accessToken } }
    );

    return {
      success: true,
      id: response.data.id,
      platform: 'facebook',
      type: 'carousel'
    };
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
