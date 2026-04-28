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
      .populate({ path: 'whatsappAccount', select: '+accessToken phoneNumberId' })
      .populate({ path: 'telegramAccount', select: '+botToken' })
      .populate({ path: 'instagramAccount', select: '+pageAccessToken pageId igAccountId' });

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

    conversation.messages.push({
      role: 'system',
      content: 'System: Conversation closed.',
      timestamp: new Date(),
    });
    await conversation.save();

    res.status(200).json({ status: 'success', data: { conversation } });
  } catch (err) {
    next(err);
  }
};

exports.toggleStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['active', 'human_handoff', 'closed'].includes(status)) {
      return next(new AppError('Invalid status.', 400));
    }

    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { status },
      { new: true }
    );

    if (!conversation) return next(new AppError('Conversation not found.', 404));

    // Add a system message to indicate status change
    const statusLabel = status === 'active' ? 'AI Agent' : status === 'human_handoff' ? 'Human Agent' : 'Closed';
    conversation.messages.push({
      role: 'system',
      content: `System: Conversation assigned to ${statusLabel}.`,
      timestamp: new Date(),
    });
    await conversation.save();

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

// ─── LEAD INTELLIGENCE DASHBOARD ─────────────────────────────────────────────
exports.getLeadsDashboard = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { platform, status, search, page = 1, limit = 20 } = req.query;

    // Interest keywords that indicate high buying intent
    const HIGH_INTEREST_KEYWORDS = [
      'price', 'cost', 'how much', 'buy', 'purchase', 'order', 'demo', 'trial',
      'interested', 'sign up', 'register', 'subscribe', 'plan', 'pricing',
      'sdx', 'product', 'service', 'feature', 'integration', 'start', 'begin',
      'kitna', 'khareedna', 'lena hai', 'batao', 'chahiye', 'karna hai',
    ];

    const filter = { user: userId };
    if (platform) filter.platform = platform;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { customerName: { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } },
        { customerUsername: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [conversations, total] = await Promise.all([
      Conversation.find(filter)
        .populate('agent', 'name')
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Conversation.countDocuments(filter),
    ]);

    // Compute interest score + classify each lead
    const leads = conversations.map((conv) => {
      const userMessages = conv.messages.filter((m) => m.role === 'user');
      const msgCount = userMessages.length;
      const allText = userMessages.map((m) => m.content?.toLowerCase() || '').join(' ');

      // Count matching interest keywords
      const keywordMatches = HIGH_INTEREST_KEYWORDS.filter((kw) =>
        allText.includes(kw.toLowerCase())
      ).length;

      // Interest score: 0–100
      // Base: message volume (up to 40pts), keywords (up to 40pts), handoff (+20pts)
      const msgScore = Math.min(msgCount * 5, 40);
      const kwScore = Math.min(keywordMatches * 8, 40);
      const handoffBonus = conv.status === 'human_handoff' ? 20 : 0;
      const interestScore = Math.min(msgScore + kwScore + handoffBonus, 100);

      // Engagement level label
      let engagementLevel, engagementColor;
      if (interestScore >= 70) { engagementLevel = 'Hot'; engagementColor = 'red'; }
      else if (interestScore >= 40) { engagementLevel = 'Warm'; engagementColor = 'amber'; }
      else if (interestScore >= 15) { engagementLevel = 'Interested'; engagementColor = 'blue'; }
      else { engagementLevel = 'Cold'; engagementColor = 'gray'; }

      // Extract matched keywords for display (unique, max 5)
      const matchedKeywords = [...new Set(
        HIGH_INTEREST_KEYWORDS.filter((kw) => allText.includes(kw.toLowerCase()))
      )].slice(0, 5);

      // Last user message preview
      const lastUserMsg = [...userMessages].reverse()[0]?.content || '';

      return {
        _id: conv._id,
        customerName: conv.customerName || conv.customerUsername || conv.customerPhone || 'Unknown',
        customerPhone: conv.customerPhone,
        customerUsername: conv.customerUsername,
        platform: conv.platform || 'whatsapp',
        status: conv.status,
        interestScore,
        engagementLevel,
        engagementColor,
        matchedKeywords,
        wantsHuman: conv.status === 'human_handoff',
        totalMessages: conv.totalMessages || conv.messages.length,
        userMessages: msgCount,
        lastMessageAt: conv.lastMessageAt || conv.updatedAt,
        lastUserMessage: lastUserMsg.slice(0, 120),
        agentName: conv.agent?.name || '—',
        createdAt: conv.createdAt,
      };
    });

    // ── Summary aggregations ──────────────────────────────────────────────────
    const [
      platformBreakdown,
      handoffCount,
      totalLeadsCount,
      hotLeadsCount,
    ] = await Promise.all([
      Conversation.aggregate([
        { $match: { user: userId } },
        { $group: { _id: '$platform', count: { $sum: 1 } } },
      ]),
      Conversation.countDocuments({ user: userId, status: 'human_handoff' }),
      Conversation.countDocuments({ user: userId }),
      // Hot leads = conversations with totalMessages >= 6 (proxy for high engagement)
      Conversation.countDocuments({ user: userId, totalMessages: { $gte: 6 } }),
    ]);

    res.status(200).json({
      status: 'success',
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      data: {
        leads,
        summary: {
          totalLeads: totalLeadsCount,
          hotLeads: hotLeadsCount,
          wantHuman: handoffCount,
          platformBreakdown: platformBreakdown.map((p) => ({ platform: p._id || 'whatsapp', count: p.count })),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

