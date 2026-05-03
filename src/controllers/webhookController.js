const WhatsAppService = require('../services/whatsappService');
const AIService = require('../services/aiService');
const WhatsappAccount = require('../models/WhatsappAccount');
const Agent = require('../models/Agent');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { decrypt } = require('../utils/encryption');
const logger = require('../utils/logger');
const { emitToUser, emitNotification } = require('../utils/socket');

// GET - Webhook verification from Meta
exports.verifyWebhook = async (req, res) => {
  try {
    const mode = req.query['hub.mode'] || req.query['hub_mode'];
    const token = req.query['hub.verify_token'] || req.query['hub_verify_token'];
    const challenge = req.query['hub.challenge'] || req.query['hub_challenge'];
    //  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    const result = await WhatsAppService.verifyWebhook(mode, token, challenge);
    logger.info('Webhook verified successfully');
    res.status(200).send(result);
  } catch (err) {
    logger.warn('Webhook verification failed');
    res.status(403).send('Forbidden');
  }
};

// POST - Receive incoming messages
exports.receiveMessage = async (req, res) => {
  // Always respond 200 immediately to Meta (within 20 seconds rule)
  res.status(200).json({ status: 'ok' });

  try {
    logger.info(`[WHATSAPP WEBHOOK RECEIVED]: ${JSON.stringify(req.body, null, 2)}`);
    const parsed = WhatsAppService.parseWebhookMessage(req.body);
    if (!parsed) return;

    if (parsed.isStatusUpdate) {
      const { messageId, status } = parsed;
      const conv = await Conversation.findOneAndUpdate(
        { 'messages.waMessageId': messageId },
        { $set: { 'messages.$.status': status } },
        { new: true }
      );
      if (conv) {
        emitToUser(conv.user.toString(), 'conversation_updated', {
          conversationId: conv._id,
          messages: conv.messages,
        });
      }
      return;
    }

    if (!parsed.text) return; // Skip non-text for now

    const { phoneNumberId, from, customerName, messageId, text, timestamp } = parsed;

    logger.info(`Incoming message from ${from} on phone ${phoneNumberId}`);

    // 1. Find WhatsApp account
    // const waAccount = await WhatsappAccount.findOne({
    //   phoneNumberId,
    //   status: 'connected',
    //   isActive: true,
    // });
    const waAccount = await WhatsappAccount.findOne({
      phoneNumberId,
      status: 'connected',
      isActive: true,
    }).select('+accessToken');   // 🔥 IMPORTANT

    if (!waAccount) {
      logger.warn(`No active WA account for phoneNumberId: ${phoneNumberId}`);
      return;
    }
    
    // 2. Find active agent for this account
    const agent = await Agent.findOne({
      whatsappAccount: waAccount._id,
      isActive: true,
    });
    if (!agent) {
      logger.warn(`No active agent for account: ${waAccount._id}`);
      return;
    }

    // 3. Find or create conversation
    let conversation = await Conversation.findOne({
      whatsappAccount: waAccount._id,
      customerPhone: from,
    }).sort({ createdAt: -1 });
    
    if (!conversation) {
      conversation = await Conversation.create({
        user: waAccount.user,
        agent: agent._id,
        whatsappAccount: waAccount._id,
        customerPhone: from,
        customerName,
        customerWaId: from,
        status: 'active',
        lastMessageAt: new Date(),
      });
      // Send greeting if configured
      if (agent.greetingMessage) {
        const waService = new WhatsAppService(decrypt(waAccount.accessToken), phoneNumberId);
        await waService.sendTextMessage(from, agent.greetingMessage);
      }
    } else if (conversation.status === 'closed') {
      // Reopen closed conversation
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
        waMessageId: messageId,
        type: 'text',
        timestamp: new Date(parseInt(timestamp) * 1000),
      });
      conversation.lastMessageAt = new Date();
      conversation.isRead = false;
      await conversation.save();

      emitNotification(waAccount.user.toString(), {
        type: 'new_message',
        title: '💬 New WhatsApp Message',
        message: `${customerName || from}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
        conversationId: conversation._id,
        platform: 'whatsapp',
      });
      return;
    }

    // 4. Check business hours
    const withinHours = AIService.isWithinBusinessHours(agent.businessHours);
    if (!withinHours && agent.outOfHoursMessage) {
      const waService = new WhatsAppService(decrypt(waAccount.accessToken), phoneNumberId);
      await waService.sendTextMessage(from, agent.outOfHoursMessage);
      return;
    }

    // 5. Check human handoff keywords
    if (AIService.shouldHandoffToHuman(text, agent.humanHandoffKeywords)) {
      conversation.status = 'human_handoff';
      conversation.messages.push({
        role: 'user',
        content: text,
        waMessageId: messageId,
        type: 'text',
        timestamp: new Date(parseInt(timestamp) * 1000),
      });
      conversation.messages.push({
        role: 'system',
        content: 'System: 🔴 HUMAN HANDOFF REQUESTED. Email notification sent to admin.',
        timestamp: new Date(),
      });
      conversation.lastMessageAt = new Date();
      conversation.isRead = false;
      await conversation.save();
      
      emitToUser(waAccount.user.toString(), 'conversation_updated', {
        conversationId: conversation._id,
        messages: conversation.messages,
      });

      emitNotification(waAccount.user.toString(), {
        type: 'human_handoff',
        title: '🔴 Human Handoff Requested',
        message: `WhatsApp: ${customerName || from} needs human support.`,
        conversationId: conversation._id,
        platform: 'whatsapp',
      });
      
      // Mock email alert
      logger.info(`[EMAIL ALERT] Human handoff triggered for WA conversation: ${conversation._id}`);

      const waService = new WhatsAppService(decrypt(waAccount.accessToken), phoneNumberId);
      await waService.sendTextMessage(from, agent.humanHandoffMessage);
      return;
    }

    // 6. Check user message limit
    const user = await User.findById(waAccount.user).select('+usage +subscription');
    const limits = user.getPlanLimits();
    if (user.usage.messagesThisMonth >= limits.messages) {
      logger.warn(`User ${user._id} hit message limit`);
      return;
    }

    // 7. Add user message to conversation
    conversation.messages.push({
      role: 'user',
      content: text,
      waMessageId: messageId,
      type: 'text',
      timestamp: new Date(parseInt(timestamp) * 1000),
    });

    // 8. Get recent context window
    const contextMessages = conversation.messages
      .filter((m) => m.role !== 'system')
      .slice(-(agent.contextWindow * 2))
      .map((m) => ({ role: m.role, content: m.content }));

    // 9. Generate AI response (platform='whatsapp' for proper formatting instructions)
    const aiResult = await AIService.generate(agent, contextMessages.slice(0, -1), text, 'whatsapp');

    // 9a. Sanitize response - remove markdown symbols not supported by WhatsApp
    const cleanReply = AIService.sanitizeForWhatsApp(aiResult.content) || 'Sorry, something went wrong.';

    // 10. Mark incoming as read
    const waService = new WhatsAppService(decrypt(waAccount.accessToken), phoneNumberId);
    await waService.markAsRead(messageId);
    // 11. Send AI reply (sanitized, human-friendly)
    const sentMsg = await waService.sendTextMessage(from, cleanReply);

    // 12. Save assistant message
    conversation.messages.push({
      role: 'assistant',
      content: aiResult.content,
      waMessageId: sentMsg?.messages?.[0]?.id,
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

    emitToUser(waAccount.user.toString(), 'conversation_updated', {
      conversationId: conversation._id,
      messages: conversation.messages,
    });

    emitNotification(waAccount.user.toString(), {
      type: 'new_message',
      title: '💬 New WhatsApp Message',
      message: `${customerName || from}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
      conversationId: conversation._id,
      platform: 'whatsapp',
    });

    // 13. Update usage counters
    await User.findByIdAndUpdate(waAccount.user, {
      $inc: {
        'usage.messagesThisMonth': 1,
        'usage.totalMessages': 1,
      },
    });

    // 14. Update agent stats
    await Agent.findByIdAndUpdate(agent._id, {
      $inc: {
        'stats.totalMessages': 2,
        'stats.totalConversations': conversation.totalMessages === 2 ? 1 : 0,
      },
    });

    logger.info(`AI reply sent to ${from} in ${aiResult.responseTime}ms`);
  } catch (err) {
    logger.error('Webhook processing error:', err.message);
  }
};
