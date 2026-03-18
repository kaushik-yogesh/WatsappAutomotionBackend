const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
const ANTHROPIC_MODELS = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];

class AIService {
  // Build messages array from conversation history
  static buildMessages(systemPrompt, conversationHistory, newUserMessage) {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: newUserMessage },
    ];
    return messages;
  }

  // Generate response using OpenAI
  static async generateOpenAI({ model = 'gpt-4o', messages, temperature = 0.7, maxTokens = 500 }) {
    try {
      const start = Date.now();
      const response = await openai.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        presence_penalty: 0.1,
        frequency_penalty: 0.1,
      });

      const responseTime = Date.now() - start;
      const content = response.choices[0]?.message?.content?.trim();
      const tokensUsed = response.usage?.total_tokens || 0;

      return { content, tokensUsed, responseTime, model };
    } catch (err) {
      logger.error('OpenAI error:', err.message);
      if (err.status === 429) throw new AppError('AI rate limit reached. Please try again shortly.', 429);
      if (err.status === 401) throw new AppError('Invalid OpenAI API key.', 500);
      throw new AppError('AI response generation failed.', 502);
    }
  }

  // Generate response using Anthropic Claude
  static async generateAnthropic({ model = 'claude-sonnet-4-6', messages, temperature = 0.7, maxTokens = 500 }) {
    try {
      const start = Date.now();

      // Anthropic expects system as separate param, not in messages
      const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
      const chatMessages = messages.filter((m) => m.role !== 'system');

      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemMsg,
        messages: chatMessages,
      });

      const responseTime = Date.now() - start;
      const content = response.content[0]?.text?.trim();
      const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

      return { content, tokensUsed, responseTime, model };
    } catch (err) {
      logger.error('Anthropic error:', err.message);
      if (err.status === 429) throw new AppError('AI rate limit reached. Please try again shortly.', 429);
      throw new AppError('AI response generation failed.', 502);
    }
  }

  // Main generate function - routes to correct provider
  static async generate(agent, conversationHistory, userMessage) {
    const messages = this.buildMessages(agent.systemPrompt, conversationHistory, userMessage);

    if (agent.aiProvider === 'anthropic') {
      return this.generateAnthropic({
        model: agent.model || 'claude-sonnet-4-6',
        messages,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      });
    }

    return this.generateOpenAI({
      model: agent.model || 'gpt-4o',
      messages,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
    });
  }

  // Check if message contains human handoff keywords
  static shouldHandoffToHuman(message, keywords = []) {
    if (!keywords.length) return false;
    const lowerMsg = message.toLowerCase();
    return keywords.some((kw) => lowerMsg.includes(kw.toLowerCase()));
  }

  // Check if current time is within business hours
  static isWithinBusinessHours(businessHours) {
    if (!businessHours?.enabled) return true;

    const now = new Date();
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = days[now.getDay()];
    const daySchedule = businessHours.schedule?.[dayName];

    if (!daySchedule?.active) return false;

    const [openH, openM] = daySchedule.open.split(':').map(Number);
    const [closeH, closeM] = daySchedule.close.split(':').map(Number);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
  }

  static getAvailableModels() {
    return {
      openai: OPENAI_MODELS,
      anthropic: ANTHROPIC_MODELS,
    };
  }
}

module.exports = AIService;
