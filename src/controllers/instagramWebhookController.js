const InstagramService = require('../services/instagramService');
const AIService = require('../services/aiService');
const InstagramAccount = require('../models/InstagramAccount');
const Agent = require('../models/Agent');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const logger = require('../utils/logger');

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
    status: { $in: ['active', 'waiting'] },
  });

  if (!conversation) {
    conversation = await Conversation.create({
      user: igAccount.user,
      agent: agent._id,
      instagramAccount: igAccount._id,
      platform: 'instagram',
      customerIgId: senderId,
      status: 'active',
      lastMessageAt: new Date(),
    });
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
  // Ignore comments made by the page/account itself
  if (commentData.from.id === igAccount.igAccountId) {
    logger.info(`Ignored self-comment by the connected account (${igAccount.igUsername || igAccount.igAccountId})`);
    return;
  }

  const text = commentData.text;
  const commentId = commentData.id;

  if (!text) return;

  // Generate short AI response for comment
  // We mock a conversation history for comments to keep it stateless but context-aware
  const contextMessages = [];
  const systemPrompt = agent.systemPrompt + "\n\nYou are replying to a public Instagram comment. Keep your reply extremely short, friendly, and under 2 sentences. Encourage them to DM for details.";

  const tempAgent = { ...agent.toObject(), systemPrompt };
  const aiResult = await AIService.generate(tempAgent, contextMessages, text);

  const igService = new InstagramService(igAccount.pageAccessToken, igAccount.pageId);
  await igService.replyToComment(igAccount.igAccountId, commentId, aiResult.content);

  // We don't save comments in Conversations model to save DB space, but we bill the token usage
  await User.findByIdAndUpdate(igAccount.user, {
    $inc: { 'usage.messagesThisMonth': 1, 'usage.totalMessages': 1 },
  });
  await Agent.findByIdAndUpdate(agent._id, {
    $inc: { 'stats.totalMessages': 1 },
  });
}

async function handleInstagramMessageEdit(event, igAccount, agent) {
  const editedMid = event?.message_edit?.mid;
  const numEdit = event?.message_edit?.num_edit;
  const igService = new InstagramService(igAccount.pageAccessToken, igAccount.pageId);

  if (!editedMid) {
    logger.info('Skipping message_edit event due to missing mid');
    return;
  }

  // Try to resolve sender using webhook payload first, then from saved conversation by message id
  let senderId = event?.sender?.id || event?.from?.id || null;
  let conversation = null;

  if (!senderId) {
    conversation = await Conversation.findOne({
      instagramAccount: igAccount._id,
      customerIgId: { $exists: true, $ne: null },
      'messages.waMessageId': editedMid,
      status: { $in: ['active', 'waiting'] },
    }).sort('-updatedAt');

    senderId = conversation?.customerIgId || null;
  }

  // Fallback: resolve sender directly from Graph API using edited message id
  if (!senderId) {
    const messageMeta = await igService.resolveMessageSender(editedMid);
    const metaSenderId = messageMeta?.from?.id || null;
    if (metaSenderId && metaSenderId !== igAccount.igAccountId) {
      senderId = metaSenderId;
      logger.info(`Resolved sender from Graph API for message_edit (mid=${editedMid}, sender=${senderId})`);
    }
  }

  if (!senderId) {
    logger.warn(`message_edit received but sender could not be resolved (mid=${editedMid})`);
    return;
  }

  const replyText = 'Maine aapka edited message dekha. Please updated message dobara bhej do, main turant reply karta hoon.';

  const sentMsg = await igService.sendTextMessage(igAccount.igAccountId, senderId, replyText);

  // Save assistant reply in existing conversation if available (or resolve once by sender)
  if (!conversation) {
    conversation = await Conversation.findOne({
      instagramAccount: igAccount._id,
      customerIgId: senderId,
      status: { $in: ['active', 'waiting'] },
    }).sort('-updatedAt');
  }

  if (conversation) {
    conversation.messages.push({
      role: 'assistant',
      content: replyText,
      waMessageId: sentMsg.message_id,
      type: 'text',
      status: 'sent',
    });
    conversation.totalMessages += 1;
    conversation.lastMessageAt = new Date();
    await conversation.save();
  }

  logger.info(`Handled Instagram message_edit event (mid=${editedMid}, num_edit=${numEdit ?? 'n/a'})`);

  await Agent.findByIdAndUpdate(agent._id, {
    $inc: { 'stats.totalMessages': 1 },
  });
}
