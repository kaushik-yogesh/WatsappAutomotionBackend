const Conversation = require('../models/Conversation');
const AppError = require('../utils/AppError');
const WhatsAppService = require('../services/whatsappService');
const TelegramService = require('../services/telegramService');
const InstagramService = require('../services/instagramService');
const { emitToUser } = require('../utils/socket');
const { decrypt } = require('../utils/encryption');

exports.getConversations = async (req, res, next) => {
  try {
    const { status, agentId, platform, page = 1, limit = 20, search } = req.query;
    const filter = { user: req.user._id };

    if (status) filter.status = status;
    if (platform) filter.platform = platform;
    if (agentId) filter.agent = agentId;
    if (search) {
      filter.$or = [
        { customerPhone: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [conversations, total] = await Promise.all([
      Conversation.find(filter)
        .populate('agent', 'name aiProvider')
        .select('-messages')
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Conversation.countDocuments(filter),
    ]);

    res.status(200).json({
      status: 'success',
      results: conversations.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      data: { conversations },
    });
  } catch (err) {
    next(err);
  }
};

exports.getConversation = async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).populate('agent', 'name aiProvider model');

    if (!conversation) return next(new AppError('Conversation not found.', 404));

    // Mark as read
    if (!conversation.isRead) {
      conversation.isRead = true;
      await conversation.save();
    }

    res.status(200).json({ status: 'success', data: { conversation } });
  } catch (err) {
    next(err);
  }
};

exports.replyToConversation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    if (!message) return next(new AppError('Message is required.', 400));

    const conversation = await Conversation.findOne({ _id: id, user: req.user._id })
      .populate('whatsappAccount telegramAccount instagramAccount');

    if (!conversation) return next(new AppError('Conversation not found.', 404));

    let sentMsg;

    if (conversation.platform === 'whatsapp') {
      const waAccount = conversation.whatsappAccount;
      if (!waAccount) return next(new AppError('WhatsApp account not connected.', 400));
      const waService = new WhatsAppService(decrypt(waAccount.accessToken), waAccount.phoneNumberId);
      sentMsg = await waService.sendTextMessage(conversation.customerPhone, message);
    } else if (conversation.platform === 'telegram') {
      const tgAccount = conversation.telegramAccount;
      if (!tgAccount) return next(new AppError('Telegram account not connected.', 400));
      const tgService = new TelegramService(tgAccount.botToken);
      sentMsg = await tgService.sendTextMessage(conversation.customerTgId, message);
    } else if (conversation.platform === 'instagram') {
      const igAccount = conversation.instagramAccount;
      if (!igAccount) return next(new AppError('Instagram account not connected.', 400));
      const igService = new InstagramService(igAccount.pageAccessToken, igAccount.pageId);
      sentMsg = await igService.sendTextMessage(igAccount.igAccountId, conversation.customerIgId, message);
    } else {
      return next(new AppError('Unsupported platform.', 400));
    }

    // Save assistant message
    conversation.messages.push({
      role: 'assistant',
      content: message,
      waMessageId: sentMsg?.messages?.[0]?.id || sentMsg?.message_id || '',
      type: 'text',
      status: 'sent',
      timestamp: new Date(),
    });

    conversation.totalMessages += 1;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    // Emit to update socket clients
    emitToUser(req.user._id.toString(), 'conversation_updated', {
      conversationId: conversation._id,
      messages: conversation.messages,
    });

    res.status(200).json({ status: 'success', data: { conversation } });
  } catch (err) {
    next(err);
  }
};

exports.closeConversation = async (req, res, next) => {
  try {
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { status: 'closed', resolvedAt: new Date() },
      { new: true }
    );
    if (!conversation) return next(new AppError('Conversation not found.', 404));
    res.status(200).json({ status: 'success', data: { conversation } });
  } catch (err) {
    next(err);
  }
};

exports.getDashboardStats = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));

    const [
      totalConversations,
      activeConversations,
      monthlyConversations,
      unreadCount,
      weeklyMessages,
      avgResponseTime,
    ] = await Promise.all([
      Conversation.countDocuments({ user: userId }),
      Conversation.countDocuments({ user: userId, status: 'active' }),
      Conversation.countDocuments({ user: userId, createdAt: { $gte: startOfMonth } }),
      Conversation.countDocuments({ user: userId, isRead: false }),
      Conversation.aggregate([
        { $match: { user: userId, createdAt: { $gte: startOfWeek } } },
        { $group: { _id: null, total: { $sum: '$totalMessages' } } },
      ]),
      Conversation.aggregate([
        { $match: { user: userId } },
        { $unwind: '$messages' },
        { $match: { 'messages.role': 'assistant', 'messages.responseTime': { $exists: true } } },
        { $group: { _id: null, avg: { $avg: '$messages.responseTime' } } },
      ]),
    ]);

    // Daily message count for last 7 days
    const dailyStats = await Conversation.aggregate([
      { $match: { user: userId, lastMessageAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$lastMessageAt' } }, count: { $sum: '$totalMessages' } } },
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        totalConversations,
        activeConversations,
        monthlyConversations,
        unreadCount,
        weeklyMessages: weeklyMessages[0]?.total || 0,
        avgResponseTime: Math.round(avgResponseTime[0]?.avg || 0),
        dailyStats,
        usage: {
          messagesThisMonth: req.user.usage?.messagesThisMonth || 0,
          limit: req.user.getPlanLimits().messages,
          plan: req.user.subscription?.plan,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};
