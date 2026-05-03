const { GoogleGenAI } = require('@google/genai');
const AppError = require('../utils/AppError');

const STYLE_PRESETS = {
  'Social Media Post':
    'Create a high-quality social media visual with clean composition, readable focal hierarchy, and strong engagement appeal.',
  'Product Ad':
    'Create a product-ad style visual with premium commercial lighting, clear subject focus, and conversion-friendly composition.',
  'Promotional Banner':
    'Create a promotional banner style visual with bold impact, marketing-ready framing, and space for headline/copy overlay.',
  Minimal:
    'Create a minimal style visual with clean negative space, restrained palette, and simple modern composition.',
  'Modern Business':
    'Create a modern business style visual with professional aesthetics, polished visuals, and contemporary brand-safe tone.',
};

const ASPECT_RATIO_HINTS = {
  '1:1': 'Square composition (1:1 ratio), optimized for feed posts.',
  '4:5': 'Portrait composition (4:5 ratio), optimized for social feed visibility.',
  '9:16': 'Vertical story composition (9:16 ratio), optimized for stories/reels.',
};

class GeminiImageService {
  static getClient() {
    if (!process.env.GEMINI_API_KEY) {
      throw new AppError('GEMINI_API_KEY is not configured on server.', 500);
    }
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  static buildPrompt({ prompt, style, aspectRatio }) {
    const styleInstruction = STYLE_PRESETS[style] || STYLE_PRESETS['Social Media Post'];
    const ratioInstruction = ASPECT_RATIO_HINTS[aspectRatio] || ASPECT_RATIO_HINTS['1:1'];

    return [
      styleInstruction,
      ratioInstruction,
      'No text watermark, no logo, no border unless explicitly requested.',
      `User prompt: ${prompt}`,
    ].join('\n');
  }

  static extractImageFromResponse(response) {
    const candidates = response?.candidates || [];

    for (const candidate of candidates) {
      const parts = candidate?.content?.parts || [];
      for (const part of parts) {
        const inlineData = part?.inlineData;
        if (inlineData?.data) {
          const mimeType = inlineData.mimeType || 'image/png';
          return {
            mimeType,
            base64Data: inlineData.data,
            dataUrl: `data:${mimeType};base64,${inlineData.data}`,
          };
        }
      }
    }

    return null;
  }

  static async generateImage({ prompt, style, aspectRatio }) {
    const ai = GeminiImageService.getClient();
    const finalPrompt = GeminiImageService.buildPrompt({ prompt, style, aspectRatio });

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
      contents: finalPrompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    const imageResult = GeminiImageService.extractImageFromResponse(response);
    if (!imageResult) {
      throw new AppError('Gemini did not return an image. Please try a different prompt.', 502);
    }

    return imageResult;
  }
}

module.exports = GeminiImageService;
