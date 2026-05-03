exports.updateScheduledJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { caption, mediaUrls, mode, scheduledAt, platforms } = req.body;

    const job = await SocialPostJob.findOne({ _id: jobId, user: req.user._id });
    if (!job) return next(new AppError('Scheduled post not found', 404));

    if (job.overallStatus !== 'queued') {
      return next(new AppError('Only queued posts can be edited', 400));
    }

    if (caption) job.masterContent.text = caption;
    if (mediaUrls) job.masterContent.mediaUrls = mediaUrls;
    if (mode) job.mode = mode;
    if (scheduledAt) job.scheduledAt = scheduledAt;
    if (platforms) {
      job.selectedPlatforms = platforms.map(p => p.platform);
      // Re-create executions if platforms changed
      job.executions = platforms.map(p => ({
        platform: p.platform,
        accountId: String(p.id),
        accountName: p.name,
        status: 'pending',
        formattedContent: SocialPostOrchestratorService.formatForPlatform({ 
          platform: p.platform, 
          text: caption || job.masterContent.text,
          mediaUrls: mediaUrls || job.masterContent.mediaUrls
        })
      }));
    }

    await job.save();
    res.status(200).json({ status: 'success', data: job });
  } catch (err) {
    next(err);
  }
};
