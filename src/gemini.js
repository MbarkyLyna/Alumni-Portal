import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiAI {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.client = apiKey ? new GoogleGenerativeAI(apiKey) : null;
    }

    async generate(prompt) {
        if (!this.client) return 'Gemini is not configured. Please set GEMINI_API_KEY in the environment variables.';
        
        try {
            const model = this.client.getGenerativeModel({ model: 'gemini-1.5-pro' });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response && typeof response.text === 'function' ? response.text() : '';
            
            if (!text || !text.trim()) {
                return 'I received an empty response. Please try rephrasing your question or ask something else.';
            }
            
            return text.trim();
        } catch (e) {
            console.error('Gemini API Error:', e);
            if (e.message && e.message.includes('API_KEY')) {
                return 'Gemini API key is invalid or missing. Please check the configuration.';
            }
            if (e.message && e.message.includes('quota')) {
                return 'Gemini API quota exceeded. Please try again later.';
            }
            return 'I encountered an error while processing your request. Please try again.';
        }
    }
}


