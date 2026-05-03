const { GoogleGenAI } = require('@google/genai');
const AppError = require('../utils/AppError');

const STYLE_PRESETS = {
  'Social Media Post':
    'Create a high-quality social media visual with clean composition, readable focal hierarchy, and strong engagement appeal.',

  'Product Ad':
    'Create a premium product advertisement visual with commercial lighting and strong conversion appeal.',

  'Promotional Banner':
    'Create a bold promotional marketing banner with strong visual impact.',

  Minimal:
    'Create a clean minimal modern design with balanced whitespace.',

  'Modern Business':
    'Create a polished professional business creative with premium branding aesthetics.',
};

const ASPECT_RATIO_HINTS = {
  '1:1': 'Square format optimized for feed posts.',
  '4:5': 'Portrait format optimized for social feed visibility.',
  '9:16': 'Vertical format optimized for stories and reels.',
};

class GeminiImageService {
  static getCandidateModels() {
    const envModel = process.env.GEMINI_IMAGE_MODEL?.trim();

    const defaults = [
      'gemini-2.5-flash',
    ];

    return envModel
      ? [envModel, ...defaults.filter((m) => m !== envModel)]
      : defaults;
  }

  static getClient() {
    if (!process.env.GEMINI_API_KEY) {
      throw new AppError('GEMINI_API_KEY is not configured on server.', 500);
    }

    return new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  static buildPrompt({ prompt, style, aspectRatio }) {
    const styleInstruction =
      STYLE_PRESETS[style] || STYLE_PRESETS['Social Media Post'];

    const ratioInstruction =
      ASPECT_RATIO_HINTS[aspectRatio] || ASPECT_RATIO_HINTS['1:1'];

    return `
${styleInstruction}
${ratioInstruction}

Generate only the final visual image.

Requirements:
- No watermark
- No logo
- No borders
- Professional social media quality
- High visual clarity

User Prompt:
${prompt}
    `.trim();
  }

  static extractImageFromResponse(response) {
    const candidates = response?.candidates || [];

    for (const candidate of candidates) {
      const parts = candidate?.content?.parts || [];

      for (const part of parts) {
        if (part?.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || 'image/png';

          return {
            mimeType,
            base64Data: part.inlineData.data,
            dataUrl: `data:${mimeType};base64,${part.inlineData.data}`,
          };
        }
      }
    }

    return null;
  }

  static async generateImage({ prompt, style, aspectRatio }) {
    const ai = this.getClient();
    const finalPrompt = this.buildPrompt({ prompt, style, aspectRatio });
    const candidateModels = this.getCandidateModels();

    let lastError;

    for (const model of candidateModels) {
      try {
        console.log(`Trying Gemini model: ${model}`);

        const response = await ai.models.generateContent({
          model,
          contents: finalPrompt,
          config: {
            responseModalities: ['IMAGE'],
          },
        });

        const imageResult = this.extractImageFromResponse(response);

        if (imageResult) {
          console.log(`Success with model: ${model}`);
          return imageResult;
        }

        console.warn(`No image returned from model: ${model}`);
      } catch (error) {
        console.error(`Model ${model} failed:`, error.message);
        lastError = error;
      }
    }

    if (lastError) {
      throw new AppError(
        `Gemini image generation failed. Last error: ${lastError.message}`,
        502
      );
    }

    throw new AppError(
      'Gemini did not return an image. Try a more descriptive prompt.',
      502
    );
  }
}

module.exports = GeminiImageService;