const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { sendEmail, emailTemplates } = require('../services/emailService');
const fraudDetectionService = require('../services/fraudDetectionService');
const logger = require('../utils/logger');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

const signRefreshToken = (id) =>
  jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN });

const sendTokens = (user, statusCode, res) => {
  const token = signToken(user._id);
  const refreshToken = signRefreshToken(user._id);

  const cookieOptions = {
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  };

  res.cookie('refreshToken', refreshToken, cookieOptions);

  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: { user },
  });
};

exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return next(new AppError('Email already registered. Please log in.', 400));

    const user = await User.create({ name, email, password });

    // Create default organization
    const Organization = require('../models/Organization');
    const org = await Organization.create({
      name: `${user.name}'s Workspace`,
      owner: user._id,
      members: [{ user: user._id, role: 'admin' }]
    });

    user.currentOrganization = org._id;
    await user.save({ validateBeforeSave: false });

    // Send verification email
    const verifyToken = user.createEmailVerifyToken();
    await user.save({ validateBeforeSave: false });

    const template = emailTemplates.verifyEmail(user.name, verifyToken);
    await sendEmail({ to: user.email, ...template });

    sendTokens(user, 201, res);
  } catch (err) {
    logger.error('Register error:', err);
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password +subscription +usage');
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (!user) {
      await fraudDetectionService.recordFailedLogin(ip, email);
      return next(new AppError('Invalid email or password.', 401));
    }

    const isCorrect = await user.correctPassword(password);
    if (!isCorrect) {
      await fraudDetectionService.recordFailedLogin(ip, email);
      return next(new AppError('Invalid email or password.', 401));
    }

    await fraudDetectionService.recordSuccessfulLogin(ip, email);
    
    // We allow login even if disabled/pending deletion, 
    // but the frontend will redirect them to a special "Pending Deletion" page.
    // However, we mark them as disabled in the response.

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    sendTokens(user, 200, res);
  } catch (err) {
    logger.error('Login error:', err);
    next(err);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) return next(new AppError('No refresh token.', 401));

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return next(new AppError('User not found.', 401));

    const newToken = signToken(user._id);
    res.status(200).json({ status: 'success', token: newToken });
  } catch (err) {
    next(new AppError('Invalid refresh token.', 401));
  }
};

exports.logout = (req, res) => {
  res.cookie('refreshToken', 'loggedout', { expires: new Date(Date.now() + 1000), httpOnly: true });
  res.status(200).json({ status: 'success', message: 'Logged out successfully.' });
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await User.findOne({
      emailVerifyToken: hashedToken,
      emailVerifyExpires: { $gt: Date.now() },
    });

    if (!user) return next(new AppError('Token is invalid or has expired.', 400));

    user.isEmailVerified = true;
    user.emailVerifyToken = undefined;
    user.emailVerifyExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({ status: 'success', message: 'Email verified successfully.' });
  } catch (err) {
    next(err);
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    // Always return same message (security - don't reveal if email exists)
    if (!user) {
      return res.status(200).json({ status: 'success', message: 'If that email exists, a reset link has been sent.' });
    }

    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    try {
      const template = emailTemplates.resetPassword(user.name, resetToken);
      await sendEmail({ to: user.email, ...template });
      logger.info(`Password reset email sent successfully to: ${user.email}`);
    } catch (emailErr) {
      logger.error(`Failed to send password reset email to ${user.email}:`, emailErr);
      // Returning specific error to help debug Vercel issues
      return next(new AppError(`Email delivery failed: ${emailErr.message}`, 500));
    }

    res.status(200).json({ status: 'success', message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    logger.error('ForgotPassword Global Error:', err);
    next(err);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) return next(new AppError('Token is invalid or has expired.', 400));

    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    sendTokens(user, 200, res);
  } catch (err) {
    next(err);
  }
};

exports.requestDeletion = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return next(new AppError('User not found.', 404));

    user.isDeletionPending = true;
    user.isAccountDisabled = true;
    user.deletionRequestedAt = new Date();
    await user.save({ validateBeforeSave: false });

    // Optionally send email confirmation here
    try {
      const template = {
        subject: 'Account Deletion Request Received',
        html: `<p>Hi ${user.name},</p><p>We have received your request to delete your account. Your account has been disabled immediately, and all your data will be permanently deleted after 30 days.</p><p>If this was a mistake, please contact our support team immediately.</p>`
      };
      await sendEmail({ to: user.email, ...template });
    } catch (err) {
      logger.error('Failed to send deletion request email:', err);
    }

    res.status(200).json({
      status: 'success',
      message: 'Deletion request received. Your account has been disabled and will be deleted in 30 days.'
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Step 1: Send 3 separate OTPs for deletion verification
 */
exports.sendDeletionOTPs = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Generate 3 random 4-digit codes
    const otp1 = Math.floor(1000 + Math.random() * 9000).toString();
    const otp2 = Math.floor(1000 + Math.random() * 9000).toString();
    const otp3 = Math.floor(1000 + Math.random() * 9000).toString();

    user.deletionOTP1 = otp1;
    user.deletionOTP2 = otp2;
    user.deletionOTP3 = otp3;
    user.deletionOTPExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
    await user.save({ validateBeforeSave: false });

    // Send codes (in one or multiple emails - sending in one for simplicity but labeled as 3 codes)
    try {
      const template = {
        subject: 'Action Required: Account Deletion Verification Codes',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #d32f2f;">Account Deletion Security Verification</h2>
            <p>You have requested to delete your account. To proceed, you must enter the following 3 security codes in order:</p>
            <div style="display: flex; justify-content: space-between; margin: 30px 0;">
              <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; text-align: center; flex: 1; margin: 5px;">
                <small>Code 1</small><br/><b style="font-size: 20px;">${otp1}</b>
              </div>
              <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; text-align: center; flex: 1; margin: 5px;">
                <small>Code 2</small><br/><b style="font-size: 20px;">${otp2}</b>
              </div>
              <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; text-align: center; flex: 1; margin: 5px;">
                <small>Code 3</small><br/><b style="font-size: 20px;">${otp3}</b>
              </div>
            </div>
            <p style="color: #666; font-size: 13px;">These codes will expire in 15 minutes. If you did not request this, please change your password immediately.</p>
          </div>
        `
      };
      await sendEmail({ to: user.email, ...template });
    } catch (err) {
      logger.error('Failed to send deletion OTPs:', err);
    }

    res.status(200).json({ status: 'success', message: '3 verification codes have been sent to your email.' });
  } catch (err) {
    next(err);
  }
};

/**
 * Step 2: Verify OTPs and Survey, then Process Request
 */
exports.confirmDeletionRequest = async (req, res, next) => {
  try {
    const { otp1, otp2, otp3, reason, feedback } = req.body;
    const user = await User.findById(req.user._id);

    if (!user.deletionOTPExpires || user.deletionOTPExpires < Date.now()) {
      return next(new AppError('Verification codes have expired. Please request new ones.', 400));
    }

    if (user.deletionOTP1 !== otp1 || user.deletionOTP2 !== otp2 || user.deletionOTP3 !== otp3) {
      return next(new AppError('One or more verification codes are incorrect.', 400));
    }

    user.isDeletionPending = true;
    user.isAccountDisabled = true;
    user.deletionRequestedAt = new Date();
    user.deletionReason = reason;
    user.deletionFeedback = feedback;
    
    // Clear OTPs
    user.deletionOTP1 = undefined;
    user.deletionOTP2 = undefined;
    user.deletionOTP3 = undefined;
    user.deletionOTPExpires = undefined;

    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      status: 'success',
      message: 'Deletion request processed successfully. Your account is now disabled.'
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Cancel Deletion Request
 */
exports.cancelDeletionRequest = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user.isDeletionPending) {
      return next(new AppError('No pending deletion request found.', 400));
    }

    user.isDeletionPending = false;
    user.isAccountDisabled = false;
    user.deletionRequestedAt = undefined;
    user.deletionReason = undefined;
    user.deletionFeedback = undefined;
    
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      status: 'success',
      message: 'Your deletion request has been cancelled and your account is now active.'
    });
  } catch (err) {
    next(err);
  }
};

exports.getMe = async (req, res) => {
  const user = await User.findById(req.user._id).select('-__v');
  res.status(200).json({ status: 'success', data: { user } });
};

exports.updateProfile = async (req, res, next) => {
  try {
    const { name } = req.body;
    const user = await User.findByIdAndUpdate(req.user._id, { name }, { new: true, runValidators: true });
    res.status(200).json({ status: 'success', data: { user } });
  } catch (err) {
    next(err);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+password');
    const { currentPassword, newPassword } = req.body;

    if (!(await user.correctPassword(currentPassword))) {
      return next(new AppError('Current password is wrong.', 401));
    }

    user.password = newPassword;
    await user.save();
    sendTokens(user, 200, res);
  } catch (err) {
    next(err);
  }
};
