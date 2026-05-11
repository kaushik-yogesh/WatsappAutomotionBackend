const { createClient } = require('redis');
const logger = require('../utils/logger');

// Define Redis URL
const REDIS_URL = process.env.REDIS_URL;

// Configure Redis Client with a reconnect strategy
const redisClient = createClient({
  url: REDIS_URL || 'redis://127.0.0.1:6379',
  socket: {
    reconnectStrategy: (retries) => {
      // Reconnect after 5 seconds, max 20 attempts
      if (retries > 20) {
        logger.error('Redis max reconnection attempts reached. Please check your REDIS_URL environment variable.');
        return new Error('Max reconnection attempts reached');
      }
      // Wait 5 seconds before retrying to prevent log spam
      return 5000;
    }
  }
});

// Avoid logging connection errors repeatedly if we don't have a valid remote URL in prod
redisClient.on('error', (err) => {
  if (err.code === 'ECONNREFUSED') {
    logger.error(`Redis connection refused at ${REDIS_URL || '127.0.0.1:6379'}. Ensure Redis is running and REDIS_URL is correctly set in your environment variables.`);
  } else {
    logger.error('Redis Client Error:', err.message);
  }
});

redisClient.on('connect', () => logger.info('Redis Client Connected'));
redisClient.on('ready', () => logger.info('Redis Client Ready to receive commands'));

// Auto-connect
(async () => {
  try {
    if (!REDIS_URL && process.env.NODE_ENV === 'production') {
      logger.warn('WARNING: REDIS_URL is not set in production. Attempting to connect to localhost, which will likely fail on cloud providers.');
    }
    await redisClient.connect();
  } catch (err) {
    logger.error('Failed to connect to Redis initially:', err.message);
  }
})();

module.exports = redisClient;
