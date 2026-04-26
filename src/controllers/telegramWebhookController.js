const TelegramService = require('../services/telegramService');
const AIService = require('../services/aiService');
const TelegramAccount = require('../models/TelegramAccount');
const Agent = require('../models/Agent');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const logger = require('../utils/logger');

exports.receiveMessage = async (req, res) => {
  // Always respond 200 immediately to Telegram
  res.status(200).json({ status: 'ok' });

  try {
    const { botUsername } = req.params;
    const parsed = TelegramService.parseWebhookMessage(req.body);
    if (!parsed || !parsed.text) return; // Skip non-text for now

    const { messageId, chatId, fromId, fromName, fromUsername, text, timestamp } = parsed;

    logger.info(`Incoming message from ${fromId} on bot ${botUsername}`);

    // 1. Find Telegram account
    const tgAccount = await TelegramAccount.findOne({
      botUsername,
      status: 'connected',
      isActive: true,
    }).select('+botToken');

    if (!tgAccount) {
      logger.warn(`No active Telegram account for botUsername: ${botUsername}`);
      return;
    }
    
    // 2. Find active agent for this account
    const agent = await Agent.findOne({
      telegramAccount: tgAccount._id,
      isActive: true,
    });
    
    if (!agent) {
      logger.warn(`No active agent for TG account: ${tgAccount._id}`);
      return;
    }

    // 3. Find or create conversation
    let conversation = await Conversation.findOne({
      telegramAccount: tgAccount._id,
      customerTgId: fromId.toString(),
    }).sort({ createdAt: -1 });
    
    if (!conversation) {
      conversation = await Conversation.create({
        user: tgAccount.user,
        agent: agent._id,
        telegramAccount: tgAccount._id,
        platform: 'telegram',
        customerTgId: fromId.toString(),
        customerUsername: fromUsername,
        customerName: fromName,
        status: 'active',
        lastMessageAt: new Date(),
      });
      
      // Send greeting if configured
      if (agent.greetingMessage) {
        const tgService = new TelegramService(tgAccount.botToken);
        await tgService.sendTextMessage(chatId, agent.greetingMessage);
      }
    } else if (conversation.status === 'closed') {
      conversation.status = 'active';
      conversation.messages.push({
        role: 'system',
        content: 'System: Conversation session was reset/reopened.',
        timestamp: new Date(),
      });
    }

    // If human handoff, just append message and do not trigger AI
    if (conversation.status === 'human_handoff') {
      conversation.messages.push({
        role: 'user',
        content: text,
        waMessageId: messageId.toString(),
        type: 'text',
        timestamp: new Date(timestamp * 1000),
      });
      conversation.lastMessageAt = new Date();
      conversation.isRead = false;
      await conversation.save();
      return;
    }

    // 4. Check business hours
    const withinHours = AIService.isWithinBusinessHours(agent.businessHours);
    if (!withinHours && agent.outOfHoursMessage) {
      const tgService = new TelegramService(tgAccount.botToken);
      await tgService.sendTextMessage(chatId, agent.outOfHoursMessage);
      return;
    }

    // 5. Check human handoff keywords
    if (AIService.shouldHandoffToHuman(text, agent.humanHandoffKeywords)) {
      conversation.status = 'human_handoff';
      await conversation.save();
      const tgService = new TelegramService(tgAccount.botToken);
      await tgService.sendTextMessage(chatId, agent.humanHandoffMessage);
      return;
    }

    // 6. Check user message limit
    const user = await User.findById(tgAccount.user).select('+usage +subscription');
    const limits = user.getPlanLimits();
    if (user.usage.messagesThisMonth >= limits.messages) {
      logger.warn(`User ${user._id} hit message limit`);
      return;
    }

    // 7. Add user message to conversation
    conversation.messages.push({
      role: 'user',
      content: text,
      waMessageId: messageId.toString(),
      type: 'text',
      timestamp: new Date(timestamp * 1000),
    });

    // 8. Get recent context window
    const contextMessages = conversation.messages
      .filter((m) => m.role !== 'system')
      .slice(-(agent.contextWindow * 2))
      .map((m) => ({ role: m.role, content: m.content }));

    // 9. Generate AI response
    const aiResult = await AIService.generate(agent, contextMessages.slice(0, -1), text);
  
    // 10. Send AI reply
    const tgService = new TelegramService(tgAccount.botToken);
    const sentMsg = await tgService.sendTextMessage(chatId, aiResult.content || "this is new AI reply");

    // 11. Save assistant message
    conversation.messages.push({
      role: 'assistant',
      content: aiResult.content,
      waMessageId: sentMsg?.result?.message_id?.toString(),
      type: 'text',
      status: 'sent',
      tokens: aiResult.tokensUsed,
      responseTime: aiResult.responseTime,
    });

    conversation.totalMessages += 2;
    conversation.totalTokensUsed += aiResult.tokensUsed;
    conversation.lastMessageAt = new Date();
    conversation.isRead = false;
    await conversation.save();

    // 12. Update usage counters
    await User.findByIdAndUpdate(tgAccount.user, {
      $inc: {
        'usage.messagesThisMonth': 1,
        'usage.totalMessages': 1,
      },
    });

    // 13. Update agent stats
    await Agent.findByIdAndUpdate(agent._id, {
      $inc: {
        'stats.totalMessages': 2,
        'stats.totalConversations': conversation.totalMessages === 2 ? 1 : 0,
      },
    });

    logger.info(`AI reply sent to TG ${fromId} in ${aiResult.responseTime}ms`);
  } catch (err) {
    logger.error('Telegram Webhook processing error:', err.message);
  }
};
