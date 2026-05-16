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

  otpChallenge: (otpCode, ip) => ({
    subject: 'Security Alert: Login Verification Required',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
      <h2>Security Verification Required</h2>
      <p>We detected a suspicious login attempt from IP address: <strong>${ip}</strong></p>
      <p>To verify it's you, please use the following One-Time Password (OTP):</p>
      <div style="background:#f4f4f5;padding:20px;text-align:center;font-size:32px;letter-spacing:10px;font-weight:bold;color:#18181b;border-radius:12px;margin:24px 0;">
        ${otpCode}
      </div>
      <p style="color:#71717a;font-size:14px;">This code expires in 5 minutes. If this wasn't you, please reset your password immediately.</p>
    </div>`,
  }),

  roleAssignmentOtp: (otpCode, targetUserName, newRole) => ({
    subject: 'Action Required: Confirm User Role Assignment',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e4e4e7;border-radius:12px;padding:24px;">
      <h2 style="color:#18181b;">Confirm Role Change</h2>
      <p>You are about to change the role of <strong>${targetUserName}</strong> to <strong>${newRole.toUpperCase()}</strong>.</p>
      <p>To confirm this administrative action, please use the following verification code:</p>
      <div style="background:#f4f4f5;padding:20px;text-align:center;font-size:32px;letter-spacing:10px;font-weight:bold;color:#18181b;border-radius:12px;margin:24px 0;border:2px dashed #25D366;">
        ${otpCode}
      </div>
      <p style="color:#71717a;font-size:14px;">This code will expire in 10 minutes. If you did not initiate this request, please ignore this email.</p>
      <hr style="border:0;border-top:1px solid #e4e4e7;margin:24px 0;"/>
      <p style="font-size:12px;color:#a1a1aa;text-align:center;">Secure Admin Action • WhatsAgent Platform</p>
    </div>`,
  }),
};

module.exports = { sendEmail, emailTemplates };
