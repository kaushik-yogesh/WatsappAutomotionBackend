const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true,
  },
  content: {
    type: String,
    required: true,
    maxlength: 10000,
  },
  waMessageId: String, // Meta's message ID
  type: {
    type: String,
    enum: ['text', 'image', 'audio', 'document', 'location', 'button', 'list'],
    default: 'text',
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read', 'failed'],
    default: 'sent',
  },
  tokens: Number,
  responseTime: Number, // ms
  timestamp: { type: Date, default: Date.now },
});

const conversationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agent',
    required: true,
  },
  whatsappAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsappAccount',
  },
  telegramAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TelegramAccount',
  },
  platform: {
    type: String,
    enum: ['whatsapp', 'telegram'],
    default: 'whatsapp',
  },

  // Customer info
  customerPhone: {
    type: String,
  },
  customerUsername: String,
  customerName: String,
  customerWaId: String,
  customerTgId: String,

  messages: [messageSchema],

  // Status
  status: {
    type: String,
    enum: ['active', 'closed', 'human_handoff', 'waiting'],
    default: 'active',
  },

  // Metadata
  totalMessages: { type: Number, default: 0 },
  totalTokensUsed: { type: Number, default: 0 },
  lastMessageAt: Date,
  resolvedAt: Date,

  // Tags for filtering
  tags: [String],
  notes: String,

  isRead: { type: Boolean, default: false },
}, {
  timestamps: true,
});

conversationSchema.index({ user: 1, status: 1 });
conversationSchema.index({ user: 1, customerPhone: 1 });
conversationSchema.index({ agent: 1 });
conversationSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
