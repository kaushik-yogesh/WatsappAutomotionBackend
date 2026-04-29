const User = require('../models/User');
const Conversation = require('../models/Conversation');
const WhatsappAccount = require('../models/WhatsappAccount');
const TelegramAccount = require('../models/TelegramAccount');
const InstagramAccount = require('../models/InstagramAccount');
const Agent = require('../models/Agent');
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
        $project: {
          password: 0,
          whatsappCount: { $size: '$whatsapp' },
          telegramCount: { $size: '$telegram' },
          instagramCount: { $size: '$instagram' }
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
