const YoutubeProvider = require('../services/youtubeProvider');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

exports.getAuthUrl = (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const scope = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/userinfo.profile',
  ].join(' ');

  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;

  res.status(200).json({ status: 'success', url });
};

exports.callback = async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return next(new AppError('Code is required', 400));

    const youtubeData = await YoutubeProvider.connectYouTube(code);

    await User.findByIdAndUpdate(req.user._id, {
      youtube: {
        connected: true,
        channelId: youtubeData.channelId,
        channelName: youtubeData.channelName,
        accessToken: youtubeData.accessToken,
        refreshToken: youtubeData.refreshToken,
        tokenExpiry: youtubeData.tokenExpiry,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'YouTube account connected successfully',
      data: {
        channelName: youtubeData.channelName,
        channelId: youtubeData.channelId,
      },
    });
  } catch (err) {
    logger.error('YouTube OAuth callback error:', err);
    next(new AppError('Failed to connect YouTube account', 500));
  }
};

exports.disconnect = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        'youtube.connected': false,
        'youtube.accessToken': null,
        'youtube.refreshToken': null,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'YouTube account disconnected',
    });
  } catch (err) {
    next(err);
  }
};
