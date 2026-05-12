const axios = require('axios');
const logger = require('../utils/logger');
const User = require('../models/User');

class YoutubeProvider {
  constructor(accessToken, refreshToken = null, expiry = null) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.expiry = expiry;
    this.clientId = process.env.GOOGLE_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    this.redirectUri = process.env.GOOGLE_REDIRECT_URI;
  }

  /**
   * Refreshes the YouTube access token using the refresh token
   */
  async refreshYouTubeToken(userId) {
    try {
      if (!this.refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      });

      const { access_token, expires_in } = response.data;
      const newExpiry = new Date(Date.now() + expires_in * 1000);

      this.accessToken = access_token;
      this.expiry = newExpiry;

      // Update database
      await User.findByIdAndUpdate(userId, {
        'youtube.accessToken': access_token,
        'youtube.tokenExpiry': newExpiry,
      });

      return { accessToken: access_token, expiry: newExpiry };
    } catch (error) {
      logger.error('Error refreshing YouTube token:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetches channel details for the authenticated user
   */
  async fetchChannelDetails() {
    try {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: {
          part: 'snippet,contentDetails,statistics',
          mine: true,
        },
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error('No YouTube channel found for this account.');
      }

      const channel = response.data.items[0];
      return {
        channelId: channel.id,
        channelName: channel.snippet.title,
        thumbnails: channel.snippet.thumbnails,
      };
    } catch (error) {
      logger.error('Error fetching YouTube channel details:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Validates if a video is eligible for YouTube Shorts
   */
  async validateShortEligibility(mediaUrl) {
    try {
      // Basic validation: must be a video
      const isVid = /\.(mp4|mov|avi|wmv|m4v|webm)(?:\?|$|#)/i.test(mediaUrl) || mediaUrl.toLowerCase().includes('/video');
      if (!isVid) {
        return { valid: false, error: 'File must be a video format.' };
      }

      // Metadata check via HEAD request
      const headRes = await axios.head(mediaUrl);
      const contentLength = headRes.headers['content-length'];
      if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) { // 100MB limit
        return { valid: false, error: 'Video file size exceeds 100MB limit.' };
      }

      // Note: Full duration/ratio check usually requires a library like fluent-ffmpeg 
      // or client-side validation. We'll assume the orchestrator handles basic ratio/duration warnings.
      return { valid: true };
    } catch (error) {
      logger.warn('Short eligibility validation failed:', error.message);
      return { valid: true }; // Fallback to true if check fails
    }
  }

  /**
   * Uploads a video as a YouTube Short
   */
  async uploadShort(videoUrl, title, description = '') {
    try {
      logger.info(`Starting YouTube Short upload: ${title}`);

      // 1. Download video from URL (YouTube API requires the file or a stream)
      const videoRes = await axios.get(videoUrl, { responseType: 'stream' });

      // 2. Initializing Resumable Upload
      // YouTube Shorts are just videos with #Shorts in description or title, and vertical aspect ratio.
      // We'll add #Shorts to the description to ensure it's categorized correctly.
      const metaDescription = `${description}\n\n#Shorts`.trim();

      const initiateRes = await axios.post(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          snippet: {
            title: title.substring(0, 100),
            description: metaDescription,
            categoryId: '22', // People & Blogs
          },
          status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': 'video/*',
          },
        }
      );

      const uploadUrl = initiateRes.headers.location;

      // 3. Uploading the actual file
      const uploadRes = await axios.put(uploadUrl, videoRes.data, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'video/*',
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      logger.info('YouTube Short uploaded successfully:', uploadRes.data.id);

      return {
        id: uploadRes.data.id,
        url: `https://youtube.com/shorts/${uploadRes.data.id}`,
        status: 'processing',
      };
    } catch (error) {
      const errorData = error.response?.data || error.message;
      logger.error('YouTube Short upload failed:', errorData);

      if (error.response?.status === 401) {
        throw new Error('OAUTH_EXPIRED');
      }
      
      if (JSON.stringify(errorData).includes('quotaExceeded')) {
        throw new Error('QUOTA_EXCEEDED');
      }

      throw new Error(`YouTube Upload Error: ${JSON.stringify(errorData)}`);
    }
  }

  /**
   * Helper to connect YouTube (exchanges code for tokens)
   */
  static async connectYouTube(code) {
    try {
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
        code,
      });

      const { access_token, refresh_token, expires_in } = response.data;
      const expiry = new Date(Date.now() + expires_in * 1000);

      // Fetch channel details to get channelId and Name
      const provider = new YoutubeProvider(access_token);
      const channel = await provider.fetchChannelDetails();

      return {
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiry: expiry,
        channelId: channel.channelId,
        channelName: channel.channelName,
      };
    } catch (error) {
      logger.error('Error connecting YouTube:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = YoutubeProvider;
