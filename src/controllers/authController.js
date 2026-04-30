const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { sendEmail, emailTemplates } = require('../services/emailService');
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

    const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil +subscription +usage');
    if (!user) return next(new AppError('Invalid email or password.', 401));

    if (user.isLocked()) {
      return next(new AppError('Account locked due to too many failed attempts. Try again after 2 hours.', 401));
    }

    const isCorrect = await user.correctPassword(password);
    if (!isCorrect) {
      await user.incLoginAttempts();
      return next(new AppError('Invalid email or password.', 401));
    }

    // Reset login attempts on success
    if (user.loginAttempts > 0) {
      await user.updateOne({ $set: { loginAttempts: 0 }, $unset: { lockUntil: 1 } });
    }

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
