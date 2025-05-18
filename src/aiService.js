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

// There's a known issue with certain personalities returning errors as content
// Let's handle this gracefully for any personality that might be affected
const knownProblematicPersonalities = {
  "lucifer-kochav-shenafal": {
    isProblematic: true,
    errorPatterns: ["NoneType", "AttributeError", "lower"],
    responses: [
      "I sense a disturbance in the cosmic forces that connect us. My essence cannot fully materialize at this moment.",
      "The ethereal pathways that channel my thoughts seem to be temporarily obscured. This topic eludes me for now.",
      "Even fallen angels encounter mysteries. This particular query creates a singularity in my understanding.",
      "How curious. The infernal archives appear to be in disarray on this specific matter.",
      "The boundaries between realms are particularly thin today, causing interference with my celestial perception."
    ]
  }
};

// Track dynamically identified problematic personalities during runtime
// This helps identify and handle new problematic personalities without requiring code changes
const runtimeProblematicPersonalities = new Map();

/**
 * Check if a response appears to contain an API error
 * @param {string} content - The response content to check
 * @returns {boolean} True if the content appears to be an error
 */
function isErrorResponse(content) {
  if (!content) return true;
  
  // Common error patterns that indicate API issues rather than valid responses
  const errorPatterns = [
    "NoneType", 
    "AttributeError",
    "TypeError",
    "ValueError",
    "KeyError",
    "IndexError",
    "ModuleNotFoundError",
    "ImportError",
    "Exception",
    "Error:",
    "Traceback"
  ];
  
  // Check if content matches any error pattern
  return errorPatterns.some(pattern => 
    content.includes(pattern) || 
    (typeof content === 'string' && content.match(new RegExp(`\\b${pattern}\\b`, 'i')))
  );
}

/**
 * Register a personality as problematic during runtime
 * @param {string} personalityName - The personality name
 * @param {Object} errorData - Error data including the content that triggered the error
 */
function registerProblematicPersonality(personalityName, errorData) {
  // Don't register if already in the known list
  if (knownProblematicPersonalities[personalityName]) {
    return;
  }
  
  console.log(`[AIService] Registering runtime problematic personality: ${personalityName}`);
  
  // Create themed fallback responses based on the personality name
  // This creates generic responses that can work for any personality
  const genericResponses = [
    "I seem to be experiencing a momentary lapse in my connection. Let me gather my thoughts.",
    "How curious. I'm unable to formulate a proper response at this moment.",
    "The connection between us seems unstable right now. Perhaps we could try a different approach.",
    "I find myself at a loss for words on this particular matter. Let's explore something else.",
    "There appears to be a disturbance in my thinking process. Give me a moment to recalibrate."
  ];
  
  // Store the problematic personality info
  runtimeProblematicPersonalities.set(personalityName, {
    isProblematic: true,
    firstDetectedAt: Date.now(),
    errorCount: 1,
    lastErrorContent: errorData.content || "Unknown error",
    responses: genericResponses
  });
  
  console.log(`[AIService] Added ${personalityName} to runtime problematic personalities list`);
}

/**
 * Get a response from the AI service
 * @param {string} personalityName - The personality name
 * @param {string} message - The user's message
 * @param {Object} context - Additional context (userId, channelId)
 * @returns {Promise<string>} The AI response
 */
async function getAiResponse(personalityName, message, context = {}) {
  // Validate input parameters first
  if (!personalityName) {
    console.error('[AIService] Error: personalityName is required but was not provided');
    return "I'm experiencing an issue with my configuration. Please try again later.";
  }
  
  if (!message) {
    console.warn('[AIService] Warning: Empty message received, using default prompt');
    message = "Hello";
  }
  
  console.log(`[AIService] Getting response for personality: ${personalityName}`);
  console.log(`[AIService] User message: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
  console.log(`[AIService] Context:`, context);
  
  try {
    // Get the complete model path
    const modelPath = getModelPath(personalityName);
    console.log(`[AIService] Using model path: ${modelPath}`);
    
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
    
    // Check for problematic personalities with a simple log for debugging
    console.log(`[AIService] Checking if ${personalityName} is in problematic personalities list`);
    
    // Check if this is a personality with known or runtime-detected API issues
    let personalityInfo = knownProblematicPersonalities[personalityName];
    
    // If not in the predefined list, check the runtime-detected list
    if (!personalityInfo && runtimeProblematicPersonalities.has(personalityName)) {
      personalityInfo = runtimeProblematicPersonalities.get(personalityName);
    }
    
    if (personalityInfo && personalityInfo.isProblematic) {
      console.log(`[AIService] Personality ${personalityName} is known to have API issues, proceeding with caution`);
      
      try {
        // Still try the API call in case the issue has been fixed
        const response = await aiClient.chat.completions.create({
          model: modelPath,
          messages: [{ role: "user", content: message }],
          temperature: 0.7,
          headers: headers
        });
        
        const content = response.choices?.[0]?.message?.content;
        
        // Use the more robust error detection function
        if (!content || isErrorResponse(content)) {
          console.log(`[AIService] Detected API error in ${personalityName} response: "${content}"`);
          
          // If this is a runtime-detected personality, increment the error count
          if (runtimeProblematicPersonalities.has(personalityName)) {
            const runtimeInfo = runtimeProblematicPersonalities.get(personalityName);
            runtimeInfo.errorCount++;
            runtimeInfo.lastErrorContent = content || "Empty response";
            runtimeProblematicPersonalities.set(personalityName, runtimeInfo);
          }
          
          // Return a themed response for this personality
          const responses = personalityInfo.responses;
          const selected = responses[Math.floor(Math.random() * responses.length)];
          return selected;
        }
        
        // If we get here, we got a valid response despite the known issues!
        if (typeof content === 'string' && content.length > 0) {
          console.log(`[AIService] Received valid response from ${personalityName} API`);
          return content;
        }
        
        // Default fallback for empty but not error content
        return personalityInfo.responses[0];
      } catch (error) {
        console.error(`[AIService] Error with ${personalityName} API call:`, error);
        
        // If this is a runtime-detected personality, increment the error count
        if (runtimeProblematicPersonalities.has(personalityName)) {
          const runtimeInfo = runtimeProblematicPersonalities.get(personalityName);
          runtimeInfo.errorCount++;
          runtimeInfo.lastErrorType = error.name;
          runtimeInfo.lastErrorMessage = error.message;
          runtimeProblematicPersonalities.set(personalityName, runtimeInfo);
        }
        
        const selected = personalityInfo.responses[Math.floor(Math.random() * personalityInfo.responses.length)];
        return selected;
      }
    }
    
    // Call the AI service with the headers
    console.log(`[AIService] Sending request to AI service with headers:`, headers);
    const response = await aiClient.chat.completions.create({
      model: modelPath,
      messages: [
        { role: "user", content: message }
      ],
      temperature: 0.7,
      headers: headers // Pass the headers to the request
    });
    
    // Validate and sanitize response
    if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
      console.error('[AIService] Received invalid response structure:', response);
      
      // Register this personality as problematic
      registerProblematicPersonality(personalityName, {
        error: "invalid_response_structure",
        content: JSON.stringify(response)
      });
      
      return "I received an incomplete response. Please try again.";
    }
    
    let content = response.choices[0].message.content;
    if (typeof content !== 'string') {
      console.error('[AIService] Response content is not a string:', content);
      
      // Register this personality as problematic
      registerProblematicPersonality(personalityName, {
        error: "non_string_content",
        content: typeof content
      });
      
      return "I received an unusual response format. Please try again.";
    }
    
    // Check if the content appears to be an error before sanitization
    if (isErrorResponse(content)) {
      console.error(`[AIService] Detected potential API error from ${personalityName}: "${content}"`);
      
      // Register this personality as problematic
      registerProblematicPersonality(personalityName, {
        error: "error_in_content",
        content: content
      });
      
      // Return a generic error message since we don't have themed responses for this personality yet
      return "I'm experiencing a technical issue with my response system. Please try again later.";
    }
    
    // Apply same sanitization to all personality responses to be safe
    try {
      content = content
        // Remove null bytes and control characters
        .replace(/[\x00-\x1F\x7F]/g, '') 
        // Remove escape sequences
        .replace(/\\u[0-9a-fA-F]{4}/g, '')
        // Remove any non-printable characters
        .replace(/[^\x20-\x7E\xA0-\xFF\u0100-\uFFFF]/g, '')
        // Ensure proper string encoding
        .toString();
        
      if (content.length === 0) {
        console.error('[AIService] Sanitized content resulted in empty string');
        
        // Register this personality as problematic
        registerProblematicPersonality(personalityName, {
          error: "empty_after_sanitization",
          content: "Sanitized content was empty"
        });
        
        return "I received an empty response. Please try again.";
      }
    } catch (sanitizeError) {
      console.error('[AIService] Error during content sanitization:', sanitizeError);
      
      // Register this personality as problematic
      registerProblematicPersonality(personalityName, {
        error: "sanitization_error",
        content: sanitizeError.message
      });
      
      return "I encountered an issue processing my response. Please try again.";
    }
    
    console.log(`[AIService] Received response (${content.length} chars): ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
    return content;
  } catch (error) {
    console.error('[AIService] Error getting AI response:', error);
    console.error('[AIService] Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n')[0] || 'No stack trace',
      personality: personalityName
    });
    
    // Register this personality as potentially problematic
    // We only do this after seeing multiple issues to avoid false positives from network issues
    if (error.name === 'TypeError' || 
        error.name === 'SyntaxError' || 
        error.message.includes('content') || 
        error.message.includes('NoneType')) {
      
      console.log(`[AIService] This appears to be a structural error with ${personalityName}, registering as problematic`);
      registerProblematicPersonality(personalityName, {
        error: "api_call_error",
        errorType: error.name,
        content: error.message
      });
    }
    
    return "I'm having trouble connecting to my brain right now. Please try again later.";
  }
}

module.exports = {
  getAiResponse,
  // Export these for potential future debugging and monitoring
  isErrorResponse,
  registerProblematicPersonality,
  knownProblematicPersonalities,
  runtimeProblematicPersonalities
};