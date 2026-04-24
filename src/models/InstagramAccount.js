const mongoose = require('mongoose');

const instagramAccountSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  igAccountId: {
    type: String,
    required: true,
  },
  igUsername: {
    type: String,
  },
  pageId: {
    type: String,
    required: true,
  },
  pageAccessToken: {
    type: String,
    required: true,
    select: false, 
  },
  status: {
    type: String,
    enum: ['connected', 'disconnected', 'error'],
    default: 'connected',
  },
  errorMessage: String,
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

instagramAccountSchema.index({ user: 1 });
instagramAccountSchema.index({ igAccountId: 1 }, { unique: true });

module.exports = mongoose.model('InstagramAccount', instagramAccountSchema);
