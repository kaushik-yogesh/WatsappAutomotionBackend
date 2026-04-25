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
    if (body.object !== 'instagram') return;

    for (const entry of body.entry) {
      const igAccountId = entry.id; // Instagram account ID that received the message
      const changes = entry.changes; // For comments
      const messaging = entry.messaging; // For DMs

      logger.info(`Processing Instagram webhook entry for ID: ${igAccountId}`);

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
          }
        }
      }

      // 4. Process Comments
      if (changes) {
        for (const change of changes) {
          if (change.field === 'comments' && change.value) {
            logger.info(`Received Instagram comment from ${change.value.from?.username || change.value.from?.id}`);
            await handleInstagramComment(change.value, igAccount, agent);
          }
        }
      }
    }
  } catch (err) {
    logger.error(`Instagram Webhook processing error: ${err.message}`);
  }
};

async function handleInstagramDM(event, igAccount, agent) {
  const senderId = event.sender.id;
  const messageId = event.message.mid;
  const text = event.message.text;

  logger.info(`Received Instagram DM from ${senderId}`);

  if (!text) return;

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
