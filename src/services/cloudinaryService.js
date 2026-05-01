const cloudinary = require('cloudinary').v2;
const logger = require('../utils/logger');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

class CloudinaryService {
  /**
   * Upload a file to Cloudinary
   * @param {string} fileContent - Base64 string or file path
   * @param {Object} options - Cloudinary upload options
   */
  static async upload(fileContent, options = {}) {
    try {
      const defaultOptions = {
        resource_type: 'auto', // Automatically detect if it's image or video
        folder: 'social_hub',
      };

      const result = await cloudinary.uploader.upload(fileContent, { ...defaultOptions, ...options });
      return {
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type,
      };
    } catch (error) {
      logger.error(`Cloudinary upload error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a file from Cloudinary
   */
  static async delete(publicId) {
    try {
      await cloudinary.uploader.destroy(publicId);
      return true;
    } catch (error) {
      logger.error(`Cloudinary delete error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = CloudinaryService;
