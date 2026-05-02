const cron = require('node-cron');
const SocialPostJob = require('../models/SocialPostJob');
const SocialPostOrchestratorService = require('./socialPostOrchestratorService');
const logger = require('../utils/logger');

let initialized = false;

const startSocialPostScheduler = () => {
  if (initialized) return;
  initialized = true;

  cron.schedule('*/1 * * * *', async () => {
    try {
      const readyJobs = await SocialPostJob.find({
        mode: 'scheduled',
        overallStatus: 'queued',
        scheduledAt: { $lte: new Date() },
      }).limit(25);

      for (const job of readyJobs) {
        await SocialPostOrchestratorService.runJob(job);
      }
    } catch (err) {
      logger.error(`Scheduled autopost worker error: ${err.message}`);
    }
  });

  logger.info('Social post scheduler initialized.');
};

module.exports = { startSocialPostScheduler };
