const User = require('../models/User');
const Conversation = require('../models/Conversation');
const WhatsappAccount = require('../models/WhatsappAccount');
const TelegramAccount = require('../models/TelegramAccount');
const InstagramAccount = require('../models/InstagramAccount');
const Agent = require('../models/Agent');
const SystemSetting = require('../models/SystemSetting');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

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

    const [whatsapp, telegram, instagram, agents] = await Promise.all([
      WhatsappAccount.find({ user: user._id }),
      TelegramAccount.find({ user: user._id }),
      InstagramAccount.find({ user: user._id }),
      Agent.find({ user: user._id })
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        user,
        accounts: { whatsapp, telegram, instagram },
        agents
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
    let settings = await SystemSetting.find();
    
    // Initialize default settings if they don't exist
    if (settings.length === 0) {
      settings = await SystemSetting.create([
        { key: 'maintenance_mode', value: false, description: 'Block all non-admin traffic' },
        { key: 'registration_enabled', value: true, description: 'Allow new user signups' },
        { key: 'whatsapp_enabled', value: true, description: 'Enable/Disable WhatsApp Service' },
        { key: 'telegram_enabled', value: true, description: 'Enable/Disable Telegram Service' },
        { key: 'instagram_enabled', value: true, description: 'Enable/Disable Instagram Service' },
        { key: 'billing_enabled', value: true, description: 'Enable/Disable Payments/Billing' },
        { key: 'ai_enabled', value: true, description: 'Enable/Disable AI Responses' },
        { key: 'global_system_prompt', value: 'You are a helpful AI business assistant.', description: 'Base prompt for all agents' },
        { key: 'openai_api_key', value: '', description: 'System-wide OpenAI API Key' },
        { key: 'anthropic_api_key', value: '', description: 'System-wide Anthropic API Key' },
        { key: 'default_ai_model', value: 'gpt-3.5-turbo', description: 'Fallback model for agents' }
      ]);
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
