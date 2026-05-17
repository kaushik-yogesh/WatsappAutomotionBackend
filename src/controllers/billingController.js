const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/User');
const Payment = require('../models/Payment');
const AppError = require('../utils/AppError');
const { sendEmail, emailTemplates } = require('../services/emailService');
const logger = require('../utils/logger');
const creditHelper = require('../utils/creditHelper');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const Plan = require('../models/Plan');
const CreditTransaction = require('../models/CreditTransaction');

exports.getPlans = async (req, res, next) => {
  try {
    const plans = await Plan.find({ isActive: true });
    res.status(200).json({
      status: 'success',
      data: {
        plans: plans.map((p) => ({
          id: p.code,
          label: p.name,
          amount: p.price * 100, // Razorpay amount in paisa
          amountInRupees: p.price,
          messages: p.messageLimit,
          agents: p.agentLimit,
          credits: p.credits,
          description: p.description,
        })),
        currentPlan: req.user.subscription?.plan,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.createOrder = async (req, res, next) => {
  try {
    const { plan } = req.body;
    const planInfo = await Plan.findOne({ code: plan, isActive: true });
    if (!planInfo) return next(new AppError('Invalid plan selected.', 400));

    const amountInPaisa = planInfo.price * 100;
    const order = await razorpay.orders.create({
      amount: amountInPaisa,
      currency: 'INR',
      receipt: `BGS${req.user._id}${Date.now()}`,
      notes: { userId: req.user._id.toString(), plan },
    });

    await Payment.create({
      user: req.user._id,
      razorpayOrderId: order.id,
      plan,
      amount: amountInPaisa,
      status: 'created',
    });

    res.status(201).json({
      status: 'success',
      data: {
        orderId: order.id,
        amount: amountInPaisa,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID,
        plan,
        planLabel: planInfo.name,
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

    const planInfo = await Plan.findOne({ code: plan });
    if (!planInfo) return next(new AppError('Invalid plan selected.', 400));

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
      'subscription.messageLimit': planInfo.messageLimit,
      'subscription.agentLimit': planInfo.agentLimit,
      'subscription.credits': planInfo.credits,
      'subscription.totalCredits': planInfo.credits,
    });

    // Log transaction
    await creditHelper.logTransaction({
      userId: req.user._id,
      type: 'addition',
      amount: planInfo.credits,
      description: `Plan Activation: Activated ${planInfo.name} tier plan`,
      metadata: { plan, razorpayPaymentId },
    });

    // Send confirmation email
    const template = emailTemplates.subscriptionConfirmed(req.user.name, planInfo.name);
    await sendEmail({ to: req.user.email, ...template });

    res.status(200).json({ status: 'success', message: `${planInfo.name} plan activated successfully!` });
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

exports.getCreditsHistory = async (req, res, next) => {
  try {
    const transactions = await CreditTransaction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.status(200).json({ status: 'success', data: { transactions } });
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
