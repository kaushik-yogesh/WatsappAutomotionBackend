const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Organization name is required'],
    trim: true,
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true,
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member'
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
});

// Create slug before saving
organizationSchema.pre('save', function(next) {
  if (this.isModified('name')) {
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    this.slug = `${this.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${randomSuffix}`;
  }
  next();
});

organizationSchema.index({ owner: 1 });
organizationSchema.index({ slug: 1 });

module.exports = mongoose.model('Organization', organizationSchema);
