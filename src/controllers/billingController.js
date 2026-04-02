const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/User');
const Payment = require('../models/Payment');
const AppError = require('../utils/AppError');
const { sendEmail, emailTemplates } = require('../services/emailService');
const logger = require('../utils/logger');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PLANS = {
  starter:    { amount: 49900,  label: 'Starter',    messages: 1000,  agents: 3  },
  pro:        { amount: 149900, label: 'Pro',         messages: 5000,  agents: 10 },
  enterprise: { amount: 499900, label: 'Enterprise',  messages: 50000, agents: 50 },
};

exports.getPlans = (req, res) => {
  res.status(200).json({
    status: 'success',
    data: {
      plans: Object.entries(PLANS).map(([key, val]) => ({
        id: key,
        ...val,
        amountInRupees: val.amount / 100,
      })),
      currentPlan: req.user.subscription?.plan,
    },
  });
};

exports.createOrder = async (req, res, next) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return next(new AppError('Invalid plan selected.', 400));

    const planInfo = PLANS[plan];
    const order = await razorpay.orders.create({
      amount: planInfo.amount,
      currency: 'INR',
      receipt: `BGS${req.user._id}_${Date.now()}`,
      notes: { userId: req.user._id.toString(), plan },
    });

    await Payment.create({
      user: req.user._id,
      razorpayOrderId: order.id,
      plan,
      amount: planInfo.amount,
      status: 'created',
    });

    res.status(201).json({
      status: 'success',
      data: {
        orderId: order.id,
        amount: planInfo.amount,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID,
        plan,
        planLabel: planInfo.label,
        prefill: { name: req.user.name, email: req.user.email },
      },
    });
  } catch (err) {
    logger.error('Create order error:', err);
    next(err);
  }
};

exports.verifyPayment = async (req, res, next) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, plan } = req.body;

    // Verify signature
    const body = razorpayOrderId + '|' + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      return next(new AppError('Payment verification failed. Invalid signature.', 400));
    }

    const planInfo = PLANS[plan];
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Update payment record
    await Payment.findOneAndUpdate(
      { razorpayOrderId },
      {
        razorpayPaymentId,
        razorpaySignature,
        status: 'captured',
        billingPeriod: { start: now, end: periodEnd },
      }
    );

    // Update user subscription
    await User.findByIdAndUpdate(req.user._id, {
      'subscription.plan': plan,
      'subscription.status': 'active',
      'subscription.currentPeriodStart': now,
      'subscription.currentPeriodEnd': periodEnd,
      'subscription.messageLimit': planInfo.messages,
      'subscription.agentLimit': planInfo.agents,
    });

    // Send confirmation email
    const template = emailTemplates.subscriptionConfirmed(req.user.name, planInfo.label);
    await sendEmail({ to: req.user.email, ...template });

    res.status(200).json({ status: 'success', message: `${planInfo.label} plan activated successfully!` });
  } catch (err) {
    logger.error('Verify payment error:', err);
    next(err);
  }
};

exports.getBillingHistory = async (req, res, next) => {
  try {
    const payments = await Payment.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.status(200).json({ status: 'success', data: { payments } });
  } catch (err) {
    next(err);
  }
};

exports.cancelSubscription = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      'subscription.plan': 'free',
      'subscription.status': 'cancelled',
      'subscription.messageLimit': 100,
      'subscription.agentLimit': 1,
    });
    res.status(200).json({ status: 'success', message: 'Subscription cancelled. You are now on the free plan.' });
  } catch (err) {
    next(err);
  }
};
