const { Resend } = require('resend');
const logger = require('../utils/logger');

// Initialize Resend with API Key
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const sendEmail = async ({ to, subject, html }) => {
  try {
    if (!resend) {
      logger.warn('RESEND_API_KEY is missing. Email not sent, logging for debug:');
      logger.info(`To: ${to}, Subject: ${subject}`);
      return;
    }

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
      to: [to],
      subject: subject,
      html: html,
    });

    if (error) {
      logger.error('Resend SMTP Error:', error);
      throw new Error(error.message);
    }

    logger.info(`Email sent successfully via Resend. ID: ${data?.id}`);
  } catch (err) {
    logger.error('Email send failed:', err.message);
    throw new Error(`Email delivery failed: ${err.message}`);
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
