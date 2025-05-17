const { OpenAI } = require('openai');
const { getApiEndpoint, getModelPath } = require('../config');

// Initialize the AI client with encoded endpoint
const aiClient = new OpenAI({
  apiKey: process.env.SERVICE_API_KEY,
  baseURL: getApiEndpoint(),
  defaultHeaders: {
    // Add any default headers here that should be sent with every request
  }
});

/**
 * Get a response from the AI service
 * @param {string} personalityName - The personality name
 * @param {string} message - The user's message
 * @param {Object} context - Additional context (userId, channelId)
 * @returns {Promise<string>} The AI response
 */
async function getAiResponse(personalityName, message, context = {}) {
  try {
    // Get the complete model path
    const modelPath = getModelPath(personalityName);
    
    // Set request-specific headers for user/channel identification
    const headers = {};
    
    // Add user ID header if provided
    if (context.userId) {
      headers['X-User-Id'] = context.userId;
    }
    
    // Add channel ID header if provided
    if (context.channelId) {
      headers['X-Channel-Id'] = context.channelId;
    }
    
    // Call the AI service with the headers
    const response = await aiClient.chat.completions.create({
      model: modelPath,
      messages: [
        { role: "user", content: message }
      ],
      temperature: 0.7,
      headers: headers // Pass the headers to the request
    });
    
    // Return the response text
    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error getting AI response:', error);
    return "I'm having trouble connecting to my brain right now. Please try again later.";
  }
}

module.exports = {
  getAiResponse
};