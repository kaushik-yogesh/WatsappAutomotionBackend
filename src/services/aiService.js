const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
const ANTHROPIC_MODELS = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

class AIService {
  // Build messages array from conversation history
  static buildMessages(systemPrompt, conversationHistory, newUserMessage, platform = 'whatsapp') {
    const isWhatsApp = platform === 'whatsapp';

    const platformInstruction = isWhatsApp
      ? `

FORMATTING RULES (strictly follow):
- Reply like a human in a casual WhatsApp chat. Be friendly, natural, and conversational.
- Keep responses SHORT and TO THE POINT. 1-3 sentences max unless detail is truly needed.
- DO NOT use markdown: no #, ##, ###, **, __, *, ~~, >, ---  or any markdown syntax.
- DO NOT use bullet points with - or * symbols. If listing, use plain numbered lines or commas.
- You may use these WhatsApp-supported symbols only when genuinely needed: *bold*, _italic_, ~strikethrough~
- Never start with greetings like 'Hello!' or 'Sure!' on every reply.
- Avoid filler phrases like 'Great question!', 'Of course!', 'Certainly!'.
- Write in plain, simple language. No jargon unless the user used it first.`
      : `

IMPORTANT: Keep responses concise and relevant. Avoid long paragraphs. Use minimal words.`;

    const messages = [
      { role: 'system', content: systemPrompt + platformInstruction },
      ...conversationHistory.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: newUserMessage },
    ];
    return messages;
  }

  // Sanitize AI response for WhatsApp - strip markdown, clean up formatting
  static sanitizeForWhatsApp(text) {
    if (!text) return text;

    let clean = text
      // Remove heading markers (# ## ### ####)
      .replace(/^#{1,6}\s*/gm, '')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // Remove bold markdown (**text** or __text__) - convert to plain
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      // Remove italic markdown (*text* or _text_) - but keep WhatsApp _italic_
      // Only strip single * used as markdown italic (not WhatsApp bold)
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
      // Remove strikethrough ~~text~~
      .replace(/~~(.+?)~~/g, '$1')
      // Remove inline code `text`
      .replace(/`(.+?)`/g, '$1')
      // Remove code blocks ```...```
      .replace(/```[\s\S]*?```/g, '')
      // Remove blockquotes >
      .replace(/^>\s*/gm, '')
      // Convert markdown bullet lists (- item or * item) to plain dashes
      .replace(/^[-*+]\s+/gm, '- ')
      // Remove excessive blank lines (more than 2 newlines → single newline)
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return clean;
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

  static async generateOpenRouter({ model = 'openai/gpt-4o-mini', messages, temperature = 0.7, maxTokens = 500 }) {
    try {
      const start = Date.now();

      const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      const data = await response.json();

      const responseTime = Date.now() - start;
      const content = data.choices?.[0]?.message?.content?.trim();
      const tokensUsed = data.usage?.total_tokens || 0;

      return { content, tokensUsed, responseTime, model };

    } catch (err) {
      logger.error('OpenRouter error:', err.message);
      throw new AppError('AI response generation failed.', 502);
    }
  }

  // Main generate function - routes to correct provider
  static async generate(agent, conversationHistory, userMessage, platform = 'whatsapp') {
    const messages = this.buildMessages(agent.systemPrompt, conversationHistory, userMessage, platform);

    try {
      if (agent.aiProvider === 'anthropic') {
        return this.generateAnthropic({
          model: agent.model || 'claude-sonnet-4-6',
          messages,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
        });
      }

      // 2️⃣ For testing → OpenRouter
      return await this.generateOpenRouter({
        model: 'openai/gpt-4o-mini',
        messages,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      });

      // return this.generateOpenAI({
      //   model: agent.model || 'gpt-4o',
      //   messages,
      //   temperature: agent.temperature,
      //   maxTokens: agent.maxTokens,
      // });
    } catch (error) {
      logger.error('Primary failed:', err.message);

      // 2️⃣ ONLY fallback → OpenRouter
      return await this.generateOpenRouter({
        model: 'openai/gpt-4o-mini',
        messages,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      });
    }


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
