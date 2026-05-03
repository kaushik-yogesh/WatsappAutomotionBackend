const InstagramService = require('../services/instagramService');
const AIService = require('../services/aiService');
const InstagramAccount = require('../models/InstagramAccount');
const Agent = require('../models/Agent');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const logger = require('../utils/logger');
const { emitToUser, emitNotification } = require('../utils/socket');

exports.verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'] || req.query['hub_mode'];
  const token = req.query['hub.verify_token'] || req.query['hub_verify_token'];
  const challenge = req.query['hub.challenge'] || req.query['hub_challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      logger.info('Instagram Webhook verified successfully');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Verification failed');
  }
  res.status(400).send('Bad request');
};

exports.receiveMessage = async (req, res) => {
  res.status(200).send('EVENT_RECEIVED'); // Always respond 200 immediately

  try {
    const { body } = req;
    logger.info(body);

    if (body.object !== 'instagram') return;

    for (const entry of body.entry) {
      const igAccountId = entry.id; // Instagram account ID that received the message
      const changes = entry.changes; // For comments
      const messaging = entry.messaging; // For DMs

      logger.info(`Processing Instagram webhook entry for ID: ${igAccountId}`);
      logger.info(`Webhook entry payload: ${JSON.stringify(entry)}`);

      // 1. Find Instagram account
      const igAccount = await InstagramAccount.findOne({
        igAccountId,
        status: 'connected',
        isActive: true,
      }).select('+pageAccessToken +pageId');

      if (!igAccount) {
        logger.warn(`Instagram account not found in DB or disconnected for ID: ${igAccountId}`);
        continue;
      }

      // 2. Find active agent
      const agent = await Agent.findOne({
        instagramAccount: igAccount._id,
        isActive: true,
      });

      if (!agent) {
        logger.warn(`No active agent found for Instagram account ID: ${igAccountId}`);
        continue;
      }

      // 3. Process DMs
      if (messaging) {
        for (const event of messaging) {
          if (event.message && !event.message.is_echo) {
            await handleInstagramDM(event, igAccount, agent);
          } else if (event.message_edit) {
            await handleInstagramMessageEdit(event, igAccount, agent);
          } else {
            logger.info(`Skipping unsupported Instagram messaging event: ${JSON.stringify(event)}`);
          }
        }
      }

      // 4. Process Comments
      if (changes) {
        for (const change of changes) {
          if (change.field === 'comments' && change.value) {
            logger.info(`Received Instagram comment from ${change.value.from?.username || change.value.from?.id}`);
            await handleInstagramComment(change.value, igAccount, agent);
          } else if (change.field === 'messages' && change.value) {
            const dmEvent = normalizeInstagramChangeMessage(change.value);
            if (dmEvent) {
              await handleInstagramDM(dmEvent, igAccount, agent);
            } else {
              logger.info(`Skipping unsupported Instagram changes.messages payload: ${JSON.stringify(change.value)}`);
            }
          }
        }
      }
    }
  } catch (err) {
    logger.error(`Instagram Webhook processing error: ${err.message}`);
  }
};

async function handleInstagramDM(event, igAccount, agent) {
  const senderId = event?.sender?.id;
  const messageId = event?.message?.mid;
  const text = event?.message?.text;

  logger.info(`Received Instagram DM from ${senderId}`);

  if (!senderId || !messageId || !text) {
    logger.info(`Skipping DM event due to missing fields (senderId=${senderId || 'n/a'}, mid=${messageId || 'n/a'}, text=${text ? 'yes' : 'no'})`);
    return;
  }

  // Ignore messages sent by the page/account itself
  if (senderId === igAccount.igAccountId) {
    logger.info(`Ignored self-DM by the connected account.`);
    return;
  }

  // Find or create conversation
  let conversation = await Conversation.findOne({
    instagramAccount: igAccount._id,
    customerIgId: senderId,
  }).sort({ createdAt: -1 });

  if (!conversation) {
    const igService = new InstagramService(igAccount.pageAccessToken, igAccount.pageId);
    const profile = await igService.getCustomerProfile(senderId);
    const customerName = profile?.name || profile?.username || '';
    
    conversation = await Conversation.create({
      user: igAccount.user,
      agent: agent._id,
      instagramAccount: igAccount._id,
      platform: 'instagram',
      customerIgId: senderId,
      customerName: customerName,
      customerUsername: profile?.username || '',
      status: 'active',
      lastMessageAt: new Date(),
    });
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
      waMessageId: messageId,
      type: 'text',
      timestamp: new Date(),
    });
    conversation.lastMessageAt = new Date();
    conversation.isRead = false;
    await conversation.save();

    emitToUser(igAccount.user.toString(), 'conversation_updated', {
      conversationId: conversation._id,
      messages: conversation.messages,
    });

    emitNotification(igAccount.user.toString(), {
      type: 'new_message',
      title: '📸 New Instagram DM',
      message: `${conversation.customerName || senderId}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
      conversationId: conversation._id,
      platform: 'instagram',
    });
    
    return;
  }

  // Check human handoff keywords
  if (AIService.shouldHandoffToHuman(text, agent.humanHandoffKeywords)) {
    conversation.status = 'human_handoff';
    conversation.messages.push({
      role: 'user',
      content: text,
      waMessageId: messageId,
      type: 'text',
      timestamp: new Date(),
    });
    conversation.messages.push({
      role: 'system',
      content: 'System: 🔴 HUMAN HANDOFF REQUESTED. Email notification sent to admin.',
      timestamp: new Date(),
    });
    conversation.lastMessageAt = new Date();
    conversation.isRead = false;
    await conversation.save();
    
    emitToUser(igAccount.user.toString(), 'conversation_updated', {
      conversationId: conversation._id,
      messages: conversation.messages,
    });

    emitNotification(igAccount.user.toString(), {
      type: 'human_handoff',
      title: '🔴 Human Handoff Requested',
      message: `Instagram: ${conversation.customerName || senderId} needs human support.`,
      conversationId: conversation._id,
      platform: 'instagram',
    });

    logger.info(`[EMAIL ALERT] Human handoff triggered for Instagram conversation: ${conversation._id}`);

    const igService = new InstagramService(igAccount.pageAccessToken, igAccount.pageId);
    await igService.sendTextMessage(igAccount.igAccountId, senderId, agent.humanHandoffMessage);
    return;
  }

  // Check limits
  const user = await User.findById(igAccount.user).select('+usage +subscription');
  const limits = user.getPlanLimits();
  if (user.usage.messagesThisMonth >= limits.messages) return;

  conversation.messages.push({
    role: 'user',
    content: text,
    waMessageId: messageId,
    type: 'text',
    timestamp: new Date(),
  });

  const contextMessages = conversation.messages
    .filter((m) => m.role !== 'system')
    .slice(-(agent.contextWindow * 2))
    .map((m) => ({ role: m.role, content: m.content }));

  const aiResult = await AIService.generate(agent, contextMessages.slice(0, -1), text);

  const igService = new InstagramService(igAccount.pageAccessToken, igAccount.pageId);
  const sentMsg = await igService.sendTextMessage(igAccount.igAccountId, senderId, aiResult.content);

  conversation.messages.push({
    role: 'assistant',
    content: aiResult.content,
    waMessageId: sentMsg.message_id,
    type: 'text',
    status: 'sent',
    tokens: aiResult.tokensUsed,
    responseTime: aiResult.responseTime,
  });

  conversation.totalMessages += 2;
  conversation.totalTokensUsed += aiResult.tokensUsed;
  conversation.lastMessageAt = new Date();
  await conversation.save();

  emitToUser(igAccount.user.toString(), 'conversation_updated', {
    conversationId: conversation._id,
    messages: conversation.messages,
  });

  emitNotification(igAccount.user.toString(), {
    type: 'new_message',
    title: '📸 New Instagram DM',
    message: `${conversation.customerName || senderId}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
    conversationId: conversation._id,
    platform: 'instagram',
  });

  await User.findByIdAndUpdate(igAccount.user, {
    $inc: { 'usage.messagesThisMonth': 1, 'usage.totalMessages': 1 },
  });
  await Agent.findByIdAndUpdate(agent._id, {
    $inc: { 'stats.totalMessages': 2, 'stats.totalConversations': conversation.totalMessages === 2 ? 1 : 0 },
  });
}

function normalizeInstagramChangeMessage(value) {
  const senderId = value?.from?.id || value?.sender?.id;
  const messageId = value?.message?.mid || value?.mid;
  const text = value?.message?.text || value?.text;
  const isEcho = value?.message?.is_echo || false;

  if (!senderId || !messageId || !text) return null;

  return {
    sender: { id: senderId },
    message: {
      mid: messageId,
      text,
      is_echo: isEcho,
    },
  };
}

async function handleInstagramComment(commentData, igAccount, agent) {
  try {
    logger.info(`Processing comment webhook payload: ${JSON.stringify(commentData)}`);
    
    // Ignore comments made by the page/account itself
    if (commentData?.from?.id === igAccount.igAccountId) {
      logger.info(`Ignored self-comment by the connected account (${igAccount.igUsername || igAccount.igAccountId})`);
      return;
    }

    const text = commentData.text;
    const commentId = commentData.id;

    if (!text || !commentId) {
      logger.warn(`Skipped comment due to missing text or commentId. Payload: ${JSON.stringify(commentData)}`);
      return;
    }

    // 1. Check if bot is enabled for this account specifically OR via Agent
    let enabled = igAccount.commentBotEnabled;
    let systemPrompt = igAccount.commentBotPrompt;

    // If not enabled specifically, check if an agent exists (legacy support)
    if (!enabled && agent) {
      // For now, let's say if an agent exists, we allow it to handle comments unless explicitly disabled
      // But user asked for a "bot", so let's prioritize the specific toggle.
      // logger.info("Account specific bot not enabled, checking agent...");
    }

    if (!enabled) {
      logger.info(`Comment bot disabled for account: ${igAccount.igUsername || igAccount.igAccountId}`);
      return;
    }

    // 2. Generate AI response
    const contextMessages = [];
    const fullPrompt = (systemPrompt || "Reply to this Instagram comment.") + "\n\nRules: Keep it short, friendly, and under 2 sentences. Use emojis if appropriate.";

    // We can use a minimal mock agent object for AIService.generate
    const tempAgent = { 
      systemPrompt: fullPrompt,
      temperature: 0.7,
      contextWindow: 1
    };
    
    const aiResult = await AIService.generate(tempAgent, contextMessages, text);

    logger.info(`AI generated comment reply: ${aiResult.content}`);

    const igService = new InstagramService(igAccount.pageAccessToken, igAccount.pageId);
    await igService.replyToComment(igAccount.igAccountId, commentId, aiResult.content);

    logger.info(`Successfully replied to comment ${commentId}`);

    // We don't save comments in Conversations model to save DB space, but we bill the token usage
    await User.findByIdAndUpdate(igAccount.user, {
      $inc: { 'usage.messagesThisMonth': 1, 'usage.totalMessages': 1 },
    });
    await Agent.findByIdAndUpdate(agent._id, {
      $inc: { 'stats.totalMessages': 1 },
    });
  } catch (error) {
    logger.error(`Error in handleInstagramComment: ${error.message}`);
  }
}

async function handleInstagramMessageEdit(event, igAccount, agent) {
  const editedMid = event?.message_edit?.mid;
  const numEdit = event?.message_edit?.num_edit;
  const igService = new InstagramService(igAccount.pageAccessToken, igAccount.pageId);

  if (!editedMid) {
    logger.info('Skipping message_edit event due to missing mid');
    return;
  }

  // Fetch the current message text and sender from Graph API
  const messageMeta = await igService.resolveMessageSender(editedMid);
  const text = messageMeta?.message;
  const metaSenderId = messageMeta?.from?.id;

  if (!text || !metaSenderId) {
    logger.warn(`message_edit received but could not resolve message text/sender from Graph API (mid=${editedMid})`);
    return;
  }

  // Ignore edits/messages made by the connected account itself
  if (metaSenderId === igAccount.igAccountId) {
    logger.info(`message_edit event is from the connected account itself, ignoring. (mid=${editedMid})`);
    return;
  }

  logger.info(`Processing message_edit dynamically (mid=${editedMid}, num_edit=${numEdit ?? 0}, sender=${metaSenderId})`);

  // Construct a simulated standard message event
  const simulatedEvent = {
    sender: { id: metaSenderId },
    message: {
      mid: editedMid,
      text: text,
      is_echo: false,
    },
    timestamp: event.timestamp || Date.now(),
  };

  // Pass it to the standard DM handler so the AI replies dynamically
  await handleInstagramDM(simulatedEvent, igAccount, agent);
}
