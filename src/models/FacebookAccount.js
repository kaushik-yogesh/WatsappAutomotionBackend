const mongoose = require('mongoose');

const facebookAccountSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  pageId: {
    type: String,
    required: true,
  },
  pageName: {
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

facebookAccountSchema.index({ user: 1 });
facebookAccountSchema.index({ pageId: 1 }, { unique: true });

module.exports = mongoose.model('FacebookAccount', facebookAccountSchema);
