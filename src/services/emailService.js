const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const sendEmail = async ({ to, subject, html }) => {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      logger.warn('SMTP credentials missing. Email not sent, but logging content for debug:');
      logger.info(`To: ${to}, Subject: ${subject}`);
      return;
    }

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'no-reply@whatsagent.com',
      to,
      subject,
      html,
    });
    logger.info(`Email sent to ${to}`);
  } catch (err) {
    logger.error('Email send failed:', err.message);
    throw new Error('Email delivery failed. Please contact support or check SMTP settings.');
  }
};

const emailTemplates = {
  welcome: (name) => ({
    subject: 'Welcome to WhatsAgent!',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
      <h2>Welcome, ${name}!</h2>
      <p>Your account has been created. Start by connecting your WhatsApp number.</p>
      <a href="${process.env.FRONTEND_URL}/dashboard" style="background:#25D366;color:white;padding:12px 24px;border-radius:6px;text-decoration:none">Go to Dashboard</a>
    </div>`,
  }),

  verifyEmail: (name, token) => ({
    subject: 'Verify your email',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
      <h2>Hi ${name}, verify your email</h2>
      <a href="${process.env.FRONTEND_URL}/verify-email?token=${token}" style="background:#25D366;color:white;padding:12px 24px;border-radius:6px;text-decoration:none">Verify Email</a>
      <p>Link expires in 24 hours.</p>
    </div>`,
  }),

  resetPassword: (name, token) => ({
    subject: 'Reset your password',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
      <h2>Hi ${name},</h2>
      <p>Click below to reset your password. Link expires in 1 hour.</p>
      <a href="${process.env.FRONTEND_URL}/reset-password?token=${token}" style="background:#ef4444;color:white;padding:12px 24px;border-radius:6px;text-decoration:none">Reset Password</a>
    </div>`,
  }),

  subscriptionConfirmed: (name, plan) => ({
    subject: 'Subscription Activated!',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
      <h2>Hi ${name}, your ${plan} plan is active!</h2>
      <p>You can now use all features. Thank you for subscribing.</p>
    </div>`,
  }),
};

module.exports = { sendEmail, emailTemplates };
