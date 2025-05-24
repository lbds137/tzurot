const { 
  getAiResponse, 
  isErrorResponse,
  createRequestId,
  isInBlackoutPeriod,
  addToBlackoutList,
  createBlackoutKey,
  errorBlackoutPeriods,
  pendingRequests
} = require('../../src/aiService');

const { USER_CONFIG } = require('../../src/constants');

// Mock auth module to bypass authentication
jest.mock('../../src/auth', () => ({
  hasValidToken: jest.fn().mockReturnValue(true),
  getUserToken: jest.fn().mockReturnValue('mock-token'),
  APP_ID: 'mock-app-id',
  API_KEY: 'mock-api-key',
  isNsfwVerified: jest.fn().mockReturnValue(true)
}));

// Mock webhookUserTracker to bypass authentication
jest.mock('../../src/utils/webhookUserTracker', () => ({
  shouldBypassNsfwVerification: jest.fn().mockReturnValue(false)
}));

// Mock OpenAI module
jest.mock('openai', () => {
  // Create a mock AI client
  const mockAIClient = {
    setShouldError: jest.fn().mockImplementation(function(shouldError) {
      this.shouldError = shouldError;
    }),
    
    chat: {
      completions: {
        create: jest.fn().mockImplementation(async function(params) {
          // Check if we should return an error
          if (mockAIClient.shouldError) {
            throw new Error('Mock API error');
          }
          
          // Return a successful response
          return {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: params.model || 'gpt-3.5-turbo',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: `This is a mock response from personality: ${params.model}. Hello there!`
                },
                finish_reason: 'stop'
              }
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 200,
              total_tokens: 300
            }
          };
        })
      }
    }
  };
  
  return {
    OpenAI: jest.fn().mockImplementation(() => mockAIClient)
  };
});

// Mock config module
jest.mock('../../config', () => ({
  getApiEndpoint: jest.fn().mockReturnValue('https://api.example.com'),
  getModelPath: jest.fn().mockReturnValue('mock-model-path')
}));

describe('AI Service', () => {
  // Save original environment variables
  const originalEnv = process.env;
  
  // Save original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  // Original setTimeout
  const originalSetTimeout = global.setTimeout;
  
  beforeEach(() => {
    // Mock environment variables
    process.env = { ...originalEnv, SERVICE_API_KEY: 'mock-api-key' };
    
    // Mock console methods to prevent noise during tests
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    
    // Mock setTimeout to execute immediately
    global.setTimeout = jest.fn((callback) => {
      // Don't actually call the callback to avoid cleaning up pending requests too early
      return 123; // Mock timer ID
    });
    
    // Clear all tracking maps
    pendingRequests.clear();
    errorBlackoutPeriods.clear();
  });
  
  afterEach(() => {
    // Restore environment variables
    process.env = originalEnv;
    
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    
    // Restore setTimeout
    global.setTimeout = originalSetTimeout;
    
    // Clear mocks
    jest.clearAllMocks();
  });
  
  // Unit test for isErrorResponse function
  describe('isErrorResponse', () => {
    it('should return true for high confidence error patterns', () => {
      const highConfidenceErrors = [
        'NoneType object has no attribute',
        'AttributeError occurred in processing',
        'TypeError: cannot access property',
        'ValueError: invalid value provided',
        'KeyError: key not found in dictionary',
        'IndexError: list index out of range',
        'ModuleNotFoundError: No module named',
        'ImportError: cannot import name'
      ];
      
      for (const message of highConfidenceErrors) {
        expect(isErrorResponse(message)).toBe(true);
      }
    });
    
    it('should return true for low confidence patterns with sufficient context', () => {
      const contextualErrors = [
        'Error: something went wrong with the connection',
        'Traceback (most recent call last):\n  File "app.py", line 42',
        'An Exception was raised during execution',
        'Python Exception was caught: Invalid syntax',
        'Exception thrown while processing request'
      ];
      
      for (const message of contextualErrors) {
        expect(isErrorResponse(message)).toBe(true);
      }
    });
    
    it('should return false for normal responses even with error-like terms', () => {
      const normalResponses = [
        'Hello, how can I help you today?',
        'That\'s an interesting question about philosophy.',
        'Let me tell you a story about a character named Error.',
        'The Exception proves the rule in this case.',
        'I traced back the origins of this concept to ancient Greece.',
        'Error detection and correction is an important topic in computer science.',
        'Errorless learning is a training technique used in psychology.',
        'The exceptional quality of their work stands out.',
        'There was an error in my previous understanding, but now I see clearly.'
      ];
      
      for (const message of normalResponses) {
        expect(isErrorResponse(message)).toBe(false);
      }
    });
    
    it('should return true for empty or null content', () => {
      expect(isErrorResponse('')).toBe(true);
      expect(isErrorResponse(null)).toBe(true);
      expect(isErrorResponse(undefined)).toBe(true);
    });
  });
  
  
  // Unit test for createBlackoutKey and blackout period functions
  describe('Blackout Period Management', () => {
    it('should create a unique blackout key for a personality-user-channel combination', () => {
      const personalityName = 'test-personality';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
      const key = createBlackoutKey(personalityName, context);
      expect(key).toBe('test-personality_user-123_channel-456');
    });
    
    it('should handle missing userId or channelId in context', () => {
      const personalityName = 'test-personality';
      
      // Missing both
      let key = createBlackoutKey(personalityName, {});
      expect(key).toBe('test-personality_anon_nochannel');
      
      // Missing channelId
      key = createBlackoutKey(personalityName, { userId: 'user-123' });
      expect(key).toBe('test-personality_user-123_nochannel');
      
      // Missing userId
      key = createBlackoutKey(personalityName, { channelId: 'channel-456' });
      expect(key).toBe('test-personality_anon_channel-456');
    });
    
    it('should add a personality to the blackout list', () => {
      const personalityName = 'test-personality';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
      addToBlackoutList(personalityName, context);
      
      const key = createBlackoutKey(personalityName, context);
      expect(errorBlackoutPeriods.has(key)).toBe(true);
      
      const expirationTime = errorBlackoutPeriods.get(key);
      expect(expirationTime).toBeGreaterThan(Date.now());
    });
    
    it('should accept a custom duration when adding to blackout list', () => {
      const personalityName = 'test-personality';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      const customDuration = 60000; // 1 minute
      
      addToBlackoutList(personalityName, context, customDuration);
      
      const key = createBlackoutKey(personalityName, context);
      expect(errorBlackoutPeriods.has(key)).toBe(true);
      
      const expirationTime = errorBlackoutPeriods.get(key);
      const expectedMinTime = Date.now() + customDuration - 100; // -100ms for test execution time
      expect(expirationTime).toBeGreaterThanOrEqual(expectedMinTime);
    });
    
    it('should detect when a personality is in a blackout period', () => {
      const personalityName = 'test-personality';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      const key = createBlackoutKey(personalityName, context);
      
      // Add to blackout list with a future expiration
      errorBlackoutPeriods.set(key, Date.now() + 10000);
      expect(isInBlackoutPeriod(personalityName, context)).toBe(true);
    });
    
    it('should detect when a personality is not in a blackout period', () => {
      const personalityName = 'test-personality';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
      // Not in blackout list
      expect(isInBlackoutPeriod(personalityName, context)).toBe(false);
      
      // In blackout list but expired
      const key = createBlackoutKey(personalityName, context);
      errorBlackoutPeriods.set(key, Date.now() - 1000); // Expired 1 second ago
      expect(isInBlackoutPeriod(personalityName, context)).toBe(false);
      
      // Verify it was removed from the map
      expect(errorBlackoutPeriods.has(key)).toBe(false);
    });
  });
  
  // Unit test for formatApiMessages function
  describe('formatApiMessages', () => {
    const { formatApiMessages } = require('../../src/aiService');
    
    it('should format a simple string message correctly', () => {
      const message = 'Hello, how are you?';
      const formattedMessages = formatApiMessages(message);
      
      expect(formattedMessages).toEqual([
        { role: 'user', content: message }
      ]);
    });
    
    it('should handle multimodal content array with image', () => {
      const multimodalContent = [
        {
          type: 'text',
          text: 'What is in this image?'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/image.jpg'
          }
        }
      ];
      
      const formattedMessages = formatApiMessages(multimodalContent);
      
      expect(formattedMessages).toEqual([
        { role: 'user', content: multimodalContent }
      ]);
    });
    
    it('should handle multimodal content array with audio', () => {
      const multimodalContent = [
        {
          type: 'text',
          text: 'Please transcribe this audio file'
        },
        {
          type: 'audio_url',
          audio_url: {
            url: 'https://example.com/audio.mp3'
          }
        }
      ];
      
      const formattedMessages = formatApiMessages(multimodalContent);
      
      expect(formattedMessages).toEqual([
        { role: 'user', content: multimodalContent }
      ]);
    });
    
    it('should not modify content array structure', () => {
      const multimodalContent = [
        { type: 'text', text: 'Text content' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }
      ];
      
      const formattedMessages = formatApiMessages(multimodalContent);
      
      // Verify that the content array structure is preserved
      expect(formattedMessages[0].content).toBe(multimodalContent);
      expect(formattedMessages[0].content[0].type).toBe('text');
      expect(formattedMessages[0].content[1].type).toBe('image_url');
    });
    
    it('should preserve audio content in multimodal array', () => {
      const multimodalContent = [
        { type: 'text', text: 'Transcribe this' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } }
      ];
      
      const formattedMessages = formatApiMessages(multimodalContent);
      
      // Verify that the audio content structure is preserved
      expect(formattedMessages[0].content).toBe(multimodalContent);
      expect(formattedMessages[0].content[0].type).toBe('text');
      expect(formattedMessages[0].content[1].type).toBe('audio_url');
      expect(formattedMessages[0].content[1].audio_url.url).toBe('https://example.com/audio.mp3');
    });
  });

  // Unit test for createRequestId function
  describe('createRequestId', () => {
    it('should create a unique request ID for tracking API requests', () => {
      const personalityName = 'test-personality';
      const message = 'This is a test message';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
      const requestId = createRequestId(personalityName, message, context);
      const expectedId = 'test-personality_user-123_channel-456_Thisisatestmessage';
      expect(requestId).toBe(expectedId);
    });
    
    it('should handle long messages by truncating to 30 characters', () => {
      const personalityName = 'test-personality';
      const message = 'This is a very long message that should be truncated to only 30 characters';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
      const requestId = createRequestId(personalityName, message, context);
      // Update the expected result based on the actual implementation (uses 30 chars)
      const expectedId = 'test-personality_user-123_channel-456_Thisisaverylongmessageth';
      expect(requestId).toBe(expectedId);
    });
    
    it('should handle missing context values', () => {
      const personalityName = 'test-personality';
      const message = 'Test message';
      
      // Missing both
      let requestId = createRequestId(personalityName, message, {});
      expect(requestId).toBe('test-personality_anon_nochannel_Testmessage');
      
      // Missing channelId
      requestId = createRequestId(personalityName, message, { userId: 'user-123' });
      expect(requestId).toBe('test-personality_user-123_nochannel_Testmessage');
      
      // Missing userId
      requestId = createRequestId(personalityName, message, { channelId: 'channel-456' });
      expect(requestId).toBe('test-personality_anon_channel-456_Testmessage');
    });
    
    it('should handle multimodal content arrays with images', () => {
      const personalityName = 'test-personality';
      const multimodalContent = [
        {
          type: 'text',
          text: 'What is in this image?'
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/image.jpg'
          }
        }
      ];
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
      // For array content, the function should use a JSON stringified representation
      const requestId = createRequestId(personalityName, multimodalContent, context);
      
      // As long as we get a non-empty string ID, it's valid
      expect(typeof requestId).toBe('string');
      expect(requestId.length).toBeGreaterThan(0);
      expect(requestId).toContain('test-personality_user-123_channel-456');
      
      // Make a second request with the same inputs
      const requestId2 = createRequestId(personalityName, multimodalContent, context);
      
      // The two IDs should be identical for deduplication
      expect(requestId).toBe(requestId2);
    });
    
    it('should handle multimodal content arrays with audio', () => {
      const personalityName = 'test-personality';
      const multimodalContent = [
        {
          type: 'text',
          text: 'Please transcribe this audio'
        },
        {
          type: 'audio_url',
          audio_url: {
            url: 'https://example.com/audio.mp3'
          }
        }
      ];
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
      // Generate request ID for audio content
      const requestId = createRequestId(personalityName, multimodalContent, context);
      
      // Verify basic properties of the ID
      expect(typeof requestId).toBe('string');
      expect(requestId.length).toBeGreaterThan(0);
      expect(requestId).toContain('test-personality_user-123_channel-456');
      
      // Make a second request with the same inputs
      const requestId2 = createRequestId(personalityName, multimodalContent, context);
      
      // The two IDs should be identical for deduplication
      expect(requestId).toBe(requestId2);
      
      // Make sure audio and image IDs are different for the same text
      const imageContent = [
        {
          type: 'text',
          text: 'Please transcribe this audio' // Same text
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/image.jpg'
          }
        }
      ];
      
      const imageRequestId = createRequestId(personalityName, imageContent, context);
      expect(imageRequestId).not.toBe(requestId);
    });
  });
  
  // Integration test for getAiResponse function
  describe('getAiResponse', () => {
    it('should return a response from the AI service', async () => {
      const personalityName = 'test-personality';
      const message = 'Hello, how are you?';
      const context = { 
        userId: 'user-123', 
        channelId: 'channel-456',
        userName: 'Test User (testuser)'
      };
      
      const response = await getAiResponse(personalityName, message, context);
      
      // Verify it returned a string
      expect(typeof response).toBe('string');
      expect(response.length).toBeGreaterThan(0);
      expect(response).toContain('This is a mock response');
    });
    
    it('should handle empty or missing messages', async () => {
      const personalityName = 'test-personality';
      const context = { 
        userId: 'user-123', 
        channelId: 'channel-456',
        userName: 'Test User (testuser)'
      };
      
      // Mock logger.warn
      const logger = require('../../src/logger');
      const originalLoggerWarn = logger.warn;
      logger.warn = jest.fn();
      
      // Empty message
      let response = await getAiResponse(personalityName, '', context);
      expect(typeof response).toBe('string');
      expect(response.length).toBeGreaterThan(0);
      
      // Undefined message
      response = await getAiResponse(personalityName, undefined, context);
      expect(typeof response).toBe('string');
      expect(response.length).toBeGreaterThan(0);
      
      // Verify warning was logged
      expect(logger.warn).toHaveBeenCalled();
      
      // Restore logger.warn
      logger.warn = originalLoggerWarn;
    });
    
    it('should handle missing personality name', async () => {
      const message = 'Test message';
      const context = { 
        userId: 'user-123', 
        channelId: 'channel-456',
        userName: 'Test User (testuser)'
      };
      
      // Mock logger.error
      const logger = require('../../src/logger');
      const originalLoggerError = logger.error;
      logger.error = jest.fn();
      
      const response = await getAiResponse(undefined, message, context);
      expect(typeof response).toBe('string');
      expect(response).toContain('issue with my configuration');
      
      // Verify error was logged
      expect(logger.error).toHaveBeenCalled();
      
      // Restore logger.error
      logger.error = originalLoggerError;
    });
    
    it('should track errors but not block API calls during blackout periods', async () => {
      const personalityName = 'test-personality';
      const message = 'Test message';
      const context = { 
        userId: 'user-123', 
        channelId: 'channel-456',
        userName: 'Test User (testuser)'
      };
      
      // Add to blackout list for monitoring
      addToBlackoutList(personalityName, context);
      
      // Verify it's tracked
      expect(isInBlackoutPeriod(personalityName, context)).toBe(true);
      
      // API call should still go through
      const response = await getAiResponse(personalityName, message, context);
      expect(response).toContain('This is a mock response');
      expect(response).not.toBe('HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY');
    });
    
    it('should prevent duplicate API calls for the same request', async () => {
      // Mock the pendingRequests.set method to verify it's being called correctly
      const originalSet = pendingRequests.set;
      const mockSet = jest.fn().mockImplementation((key, value) => {
        return originalSet.call(pendingRequests, key, value);
      });
      pendingRequests.set = mockSet;
      
      const personalityName = 'test-personality';
      const message = 'Test message';
      const context = { 
        userId: 'user-123', 
        channelId: 'channel-456',
        userName: 'Test User (testuser)'
      };
      
      // Manually add a pending request to the map to simulate a request in progress
      const requestId = createRequestId(personalityName, message, context);
      pendingRequests.set(requestId, {
        timestamp: Date.now(),
        promise: Promise.resolve('Mock API response')
      });
      
      // Verify we have a pending request
      expect(pendingRequests.size).toBe(1);
      
      // Make a duplicate request
      const response = await getAiResponse(personalityName, message, context);
      expect(response).toBe('Mock API response');
      
      // pendingRequests.set should not have been called again for the same request
      expect(mockSet.mock.calls.length).toBe(1);
      
      // Restore the original set method
      pendingRequests.set = originalSet;
    });
    
    it('should handle API errors gracefully', async () => {
      const personalityName = 'error-personality';
      const message = 'Test message';
      const context = { 
        userId: 'user-123', 
        channelId: 'channel-456',
        userName: 'Test User (testuser)'
      };
      
      // Get the mock AI client
      const openaiModule = require('openai');
      const OpenAI = openaiModule.OpenAI;
      const mockClient = new OpenAI();
      
      // Force an error
      mockClient.setShouldError(true);
      
      const response = await getAiResponse(personalityName, message, context);
      
      // Verify we get the special error marker
      expect(response).toBe('HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY');
      
      // Verify the personality was added to the blackout list
      const key = createBlackoutKey(personalityName, context);
      expect(errorBlackoutPeriods.has(key)).toBe(true);
      
      // Reset the mock for other tests
      mockClient.setShouldError(false);
    });
    
    
  });
});