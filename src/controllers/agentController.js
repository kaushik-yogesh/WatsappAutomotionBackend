const Agent = require('../models/Agent');
const WhatsappAccount = require('../models/WhatsappAccount');
const AppError = require('../utils/AppError');
const AIService = require('../services/aiService');

exports.createAgent = async (req, res, next) => {
  try {
    const { whatsappAccountId, ...agentData } = req.body;

    // Verify WA account belongs to user
    const waAccount = await WhatsappAccount.findOne({
      _id: whatsappAccountId,
      user: req.user._id,
      status: 'connected',
    });
    if (!waAccount) return next(new AppError('WhatsApp account not found or not connected.', 404));

    // Check agent limit
    const agentCount = await Agent.countDocuments({ user: req.user._id, isActive: true });
    const limits = req.user.getPlanLimits();
    if (agentCount >= limits.agents) {
      return next(new AppError(`Your plan allows only ${limits.agents} agent(s). Please upgrade.`, 403));
    }

    const agent = await Agent.create({
      ...agentData,
      user: req.user._id,
      whatsappAccount: whatsappAccountId,
    });

    res.status(201).json({ status: 'success', data: { agent } });
  } catch (err) {
    next(err);
  }
};

exports.getAgents = async (req, res, next) => {
  try {
    const agents = await Agent.find({ user: req.user._id, isActive: true })
      .populate('whatsappAccount', 'displayPhoneNumber verifiedName status')
      .lean();
    res.status(200).json({ status: 'success', results: agents.length, data: { agents } });
  } catch (err) {
    next(err);
  }
};

exports.getAgent = async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.user._id })
      .populate('whatsappAccount', 'displayPhoneNumber verifiedName status');
    if (!agent) return next(new AppError('Agent not found.', 404));
    res.status(200).json({ status: 'success', data: { agent } });
  } catch (err) {
    next(err);
  }
};

exports.updateAgent = async (req, res, next) => {
  try {
    const forbidden = ['user', 'whatsappAccount', 'stats'];
    forbidden.forEach((f) => delete req.body[f]);

    const agent = await Agent.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!agent) return next(new AppError('Agent not found.', 404));
    res.status(200).json({ status: 'success', data: { agent } });
  } catch (err) {
    next(err);
  }
};

exports.deleteAgent = async (req, res, next) => {
  try {
    const agent = await Agent.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isActive: false },
      { new: true }
    );
    if (!agent) return next(new AppError('Agent not found.', 404));
    res.status(200).json({ status: 'success', message: 'Agent deleted.' });
  } catch (err) {
    next(err);
  }
};

exports.toggleAgent = async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ _id: req.params.id, user: req.user._id });
    if (!agent) return next(new AppError('Agent not found.', 404));
    agent.isActive = !agent.isActive;
    await agent.save();
    res.status(200).json({ status: 'success', data: { agent } });
  } catch (err) {
    next(err);
  }
};

// Test agent with a sample message
exports.testAgent = async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message) return next(new AppError('Test message is required.', 400));

    const agent = await Agent.findOne({ _id: req.params.id, user: req.user._id });
    if (!agent) return next(new AppError('Agent not found.', 404));

    const result = await AIService.generate(agent, [], message);
    res.status(200).json({
      status: 'success',
      data: {
        response: result.content,
        tokensUsed: result.tokensUsed,
        responseTime: result.responseTime,
        model: result.model,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getAvailableModels = (req, res) => {
  res.status(200).json({ status: 'success', data: AIService.getAvailableModels() });
};
