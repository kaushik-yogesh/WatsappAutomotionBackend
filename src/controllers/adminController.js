const User = require('../models/User');
const Conversation = require('../models/Conversation');
const WhatsappAccount = require('../models/WhatsappAccount');
const TelegramAccount = require('../models/TelegramAccount');
const InstagramAccount = require('../models/InstagramAccount');
const SocialPostJob = require('../models/SocialPostJob');
const Agent = require('../models/Agent');
const SystemSetting = require('../models/SystemSetting');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const cloudinary = require('cloudinary').v2;

/**
 * Get overall system statistics
 */
exports.getStats = async (req, res, next) => {
  try {
    const [
      totalUsers,
      newUsers,
      totalMessages,
      whatsappAccounts,
      telegramAccounts,
      instagramAccounts,
      totalAgents,
      humanHandoffs
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
      User.aggregate([{ $group: { _id: null, total: { $sum: '$usage.totalMessages' } } }]),
      WhatsappAccount.countDocuments(),
      TelegramAccount.countDocuments(),
      InstagramAccount.countDocuments(),
      Agent.countDocuments(),
      Conversation.countDocuments({ status: 'human_handoff' })
    ]);

    // Plan distribution
    const planStats = await User.aggregate([
      { $match: { role: 'user' } },
      { $group: { _id: '$subscription.plan', count: { $sum: 1 } } }
    ]);

    // Platform distribution
    const platformStats = await Conversation.aggregate([
      { $group: { _id: '$platform', count: { $sum: 1 } } }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        overview: {
          users: { total: totalUsers, new: newUsers },
          messages: { total: totalMessages[0]?.total || 0 },
          accounts: {
            whatsapp: whatsappAccounts,
            telegram: telegramAccounts,
            instagram: instagramAccounts,
            total: whatsappAccounts + telegramAccounts + instagramAccounts
          },
          agents: totalAgents,
          activeHandoffs: humanHandoffs
        },
        plans: planStats.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),
        platforms: platformStats.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {})
      }
    });
  } catch (err) {
    logger.error('Admin stats error:', err);
    next(err);
  }
};

/**
 * Get all users with pagination
 */
exports.getAllUsers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const users = await User.aggregate([
      { $match: { role: 'user' } },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'whatsappaccounts',
          localField: '_id',
          foreignField: 'user',
          as: 'whatsapp'
        }
      },
      {
        $lookup: {
          from: 'telegramaccounts',
          localField: '_id',
          foreignField: 'user',
          as: 'telegram'
        }
      },
      {
        $lookup: {
          from: 'instagramaccounts',
          localField: '_id',
          foreignField: 'user',
          as: 'instagram'
        }
      },
      {
        $addFields: {
          whatsappCount: { $size: '$whatsapp' },
          telegramCount: { $size: '$telegram' },
          instagramCount: { $size: '$instagram' }
        }
      },
      {
        $project: {
          password: 0,
          whatsapp: 0,
          telegram: 0,
          instagram: 0
        }
      }
    ]);

    const total = await User.countDocuments({ role: 'user' });

    res.status(200).json({
      status: 'success',
      results: users.length,
      total,
      data: { users }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get specific user details with their connected accounts
 */
exports.getUserDetails = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return next(new AppError('User not found', 404));
    
    const Payment = require('../models/Payment');

    const [whatsapp, telegram, instagram, agents, payments] = await Promise.all([
      WhatsappAccount.find({ user: user._id }),
      TelegramAccount.find({ user: user._id }),
      InstagramAccount.find({ user: user._id }),
      Agent.find({ user: user._id }),
      Payment.find({ user: user._id }).sort({ createdAt: -1 }).limit(10)
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        user,
        accounts: { whatsapp, telegram, instagram },
        agents,
        payments
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update user subscription/status
 */
exports.updateUser = async (req, res, next) => {
  try {
    const { plan, status, isActive } = req.body;
    
    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));

    if (plan) user.subscription.plan = plan;
    if (status) user.subscription.status = status;
    if (isActive !== undefined) user.isActive = isActive;

    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      status: 'success',
      data: { user }
    });
  } catch (err) {
    next(err);
  }
};

const { getStats } = require('../middleware/healthMonitor');

/**
 * Get system health and resource usage
 */
exports.getSystemHealth = async (req, res, next) => {
  try {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const monitorStats = getStats();
    
    res.status(200).json({
      status: 'success',
      data: {
        uptime: Math.floor(uptime),
        memory: {
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024)
        },
        monitor: monitorStats,
        platform: process.platform,
        nodeVersion: process.version,
        timestamp: new Date()
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get all system settings
 */
exports.getSystemSettings = async (req, res, next) => {
  try {
    const defaultSettings = [
      { key: 'maintenance_mode', value: false, description: 'Block all non-admin traffic' },
      { key: 'registration_enabled', value: true, description: 'Allow new user signups' },
      { key: 'billing_enabled', value: true, description: 'Enable/Disable Payments/Billing' },
      { key: 'whatsapp_enabled', value: true, description: 'Enable/Disable WhatsApp Service' },
      { key: 'telegram_enabled', value: true, description: 'Enable/Disable Telegram Service' },
      { key: 'instagram_enabled', value: true, description: 'Enable/Disable Instagram Service' },
      { key: 'ai_responses_enabled', value: true, description: 'Enable/Disable AI Responses' },
      { key: 'global_system_prompt', value: 'You are a helpful AI business assistant.', description: 'Base prompt for all agents' },
      { key: 'openai_api_key', value: '', description: 'System-wide OpenAI API Key' },
      { key: 'anthropic_api_key', value: '', description: 'System-wide Anthropic API Key' },
      { key: 'default_ai_model', value: 'gpt-3.5-turbo', description: 'Fallback model for agents' }
    ];

    let settings = await SystemSetting.find();
    
    // Check if any default settings are missing and add them
    const existingKeys = settings.map(s => s.key);
    const missingSettings = defaultSettings.filter(ds => !existingKeys.includes(ds.key));

    if (missingSettings.length > 0) {
      const newSettings = await SystemSetting.create(missingSettings);
      settings = [...settings, ...newSettings];
    }

    res.status(200).json({
      status: 'success',
      data: { settings }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update a system setting
 */
exports.updateSystemSetting = async (req, res, next) => {
  try {
    const { key, value } = req.body;
    
    const setting = await SystemSetting.findOneAndUpdate(
      { key },
      { value, updatedBy: req.user._id },
      { new: true, upsert: true }
    );

    res.status(200).json({
      status: 'success',
      data: { setting }
    });
  } catch (err) {
    next(err);
  }
};

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Get system logs
 */
exports.getSystemLogs = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const logs = [];

    const readLogFile = async (filename) => {
      const filePath = path.join(process.cwd(), 'logs', filename);
      if (!fs.existsSync(filePath)) return;
      
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
      
      for await (const line of rl) {
        if (line.trim()) {
          try {
            logs.push({ ...JSON.parse(line), sourceFile: filename });
          } catch (e) {}
        }
      }
    };

    await readLogFile('publish.log');
    await readLogFile('error.log');

    // Sort by timestamp descending
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    const uniqueLogs = [];
    const seen = new Set();
    for (const log of logs) {
      const key = `${log.timestamp}-${log.level}-${log.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueLogs.push(log);
      }
    }

    res.status(200).json({
      status: 'success',
      data: { logs: uniqueLogs.slice(0, limit) }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get media files not linked to any post or user
 */
exports.getOrphanMedia = async (req, res, next) => {
  try {
    // 1. Get resources from Cloudinary
    // Defaulting to social_hub folder as defined in cloudinaryService
    const cloudResources = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'social_hub/',
      max_results: 500
    });

    const cloudFiles = cloudResources.resources.map(r => ({
      publicId: r.public_id,
      url: r.secure_url,
      resourceType: r.resource_type,
      createdAt: r.created_at,
      bytes: r.bytes,
      format: r.format
    }));

    // 2. Get all media URLs from SocialPostJob
    const jobs = await SocialPostJob.find({}, 'masterContent.mediaUrls executions.formattedContent.mediaUrls');
    const dbMediaUrls = new Set();
    jobs.forEach(job => {
      // Check masterContent
      if (job.masterContent?.mediaUrls) {
        job.masterContent.mediaUrls.forEach(url => {
          if (url) dbMediaUrls.add(url);
        });
      }
      // Check executions
      if (job.executions) {
        job.executions.forEach(exec => {
          if (exec.formattedContent?.mediaUrls) {
            exec.formattedContent.mediaUrls.forEach(url => {
              if (url) dbMediaUrls.add(url);
            });
          }
        });
      }
    });

    // 3. Find orphans
    const orphans = cloudFiles.filter(file => {
      // Check if any URL in DB contains this publicId
      const isReferenced = Array.from(dbMediaUrls).some(dbUrl => dbUrl && dbUrl.includes(file.publicId));
      return !isReferenced;
    });

    res.status(200).json({
      status: 'success',
      count: orphans.length,
      data: { orphans }
    });
  } catch (err) {
    logger.error('Error fetching orphan media:', err);
    res.status(500).json({
      status: 'error',
      message: 'Could not fetch orphan media. Make sure Cloudinary API is configured correctly.'
    });
  }
};

/**
 * Delete media from Cloudinary
 */
exports.deleteMedia = async (req, res, next) => {
  try {
    const { publicIds } = req.body;
    
    if (!publicIds || !Array.isArray(publicIds) || publicIds.length === 0) {
      return next(new AppError('Please provide publicIds to delete', 400));
    }

    const result = await cloudinary.api.delete_resources(publicIds);

    res.status(200).json({
      status: 'success',
      data: { result }
    });
  } catch (err) {
    logger.error('Error deleting media:', err);
    next(err);
  }
};
