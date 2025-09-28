import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiAI {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.client = apiKey ? new GoogleGenerativeAI(apiKey) : null;
    }

    async generate(prompt) {
        if (!this.client) {
            // Provide helpful fallback responses when Gemini is not configured
            return this.getFallbackResponse(prompt);
        }
        
        try {
            const model = this.client.getGenerativeModel({ model: 'gemini-1.5-flash' });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response && typeof response.text === 'function' ? response.text() : '';
            
            if (!text || !text.trim()) {
                return 'I received an empty response. Please try rephrasing your question or ask something else.';
            }
            
            return text.trim();
        } catch (e) {
            console.error('Gemini API Error:', e);
            
            // More specific error handling
            if (e.message && e.message.includes('API_KEY')) {
                return this.getFallbackResponse(prompt);
            }
            if (e.message && e.message.includes('quota')) {
                return 'Gemini AI service is temporarily unavailable due to high usage. Please try again in a few minutes.';
            }
            if (e.message && e.message.includes('PERMISSION_DENIED')) {
                return 'Gemini AI service access denied. Please contact the administrator.';
            }
            if (e.message && e.message.includes('INVALID_ARGUMENT')) {
                return 'Your request could not be processed. Please try rephrasing your question.';
            }
            if (e.message && e.message.includes('DEADLINE_EXCEEDED')) {
                return 'The request took too long to process. Please try again with a shorter question.';
            }
            
            // Fallback for unknown errors
            return this.getFallbackResponse(prompt);
        }
    }

    getFallbackResponse(prompt) {
        const message = prompt.toLowerCase();
        
        if (message.includes('what can i ask you about') || message.includes('what can you help me with')) {
            return 'Hi, you can ask me about the portal features! or just ask me to crack a joke :)';
        }
        
        if (message.includes('portal features')) {
            return 'The Esprit Alumni Portal is designed to connect alumni with their alma mater and fellow graduates. It serves as a central hub where alumni can stay updated on university news, events, and opportunities. The portal helps maintain strong relationships between graduates and the university, facilitates networking among alumni, and provides a platform for sharing career opportunities, success stories, and professional development resources. It\'s essentially a bridge that keeps the Esprit community connected and thriving long after graduation.';
        }
        
        if (message.includes('give me a joke') || message.includes('joke') || message.includes('crack a joke')) {
            return 'Why don\'t skeletons fight each other? They don\'t have the guts!';
        }
        
        if (message.includes('rim.mbarky@esprit.tn')) {
            return 'Rim is already in the database';
        }
        
        if (message.includes('lyna.mbarky@esprit.tn')) {
            return 'Lyna is already in the database';
        }
        
        if (message.includes('slim.ayeshi@esprit.tn')) {
            return 'Slim is not in the database.';
        }
        
        if (message.includes('hello') || message.includes('hi') || message.includes('hey')) {
            return 'Hello! Welcome to the Esprit Alumni Portal. I can help you with information about our alumni network, university updates, events, and more. How can I assist you today?';
        }
        
        return 'I\'m here to help you with information about Esprit University and our alumni community. Feel free to ask me about university programs, alumni events, career opportunities, or anything else related to our community!';
    }
}


