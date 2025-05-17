const { OpenAI } = require('openai');
const { getApiEndpoint, getModelPath } = require('../config');

// Initialize the AI client with encoded endpoint
const aiClient = new OpenAI({
  apiKey: process.env.SERVICE_API_KEY,
  baseURL: getApiEndpoint()
});

/**
 * Get a response from the AI service
 * @param {string} personalityName - The personality name
 * @param {string} message - The user's message
 * @returns {Promise<string>} The AI response
 */
async function getAiResponse(personalityName, message) {
  try {
    // Get the complete model path
    const modelPath = getModelPath(personalityName);
    
    // Call the AI service
    const response = await aiClient.chat.completions.create({
      model: modelPath,
      messages: [
        { role: "user", content: message }
      ],
      temperature: 0.7
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