const { 
  getAiResponse, 
  isErrorResponse,
  registerProblematicPersonality,
  createRequestId,
  isInBlackoutPeriod,
  addToBlackoutList,
  createBlackoutKey,
  runtimeProblematicPersonalities,
  errorBlackoutPeriods,
  pendingRequests,
  knownProblematicPersonalities
} = require('../../src/aiService');

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
                  content: `This is a mock response from the AI for personality: ${params.model}. I am responding to your message.`
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
    runtimeProblematicPersonalities.clear();
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
    it('should return true for common error patterns', () => {
      const errorMessages = [
        'NoneType object has no attribute',
        'AttributeError occurred',
        'Traceback (most recent call last)',
        'TypeError: cannot access',
        'ValueError: invalid value',
        'KeyError: key not found',
        'Error: something went wrong',
        'I got an ImportError trying to respond'
      ];
      
      for (const message of errorMessages) {
        expect(isErrorResponse(message)).toBe(true);
      }
    });
    
    it('should return false for normal responses', () => {
      const normalResponses = [
        'Hello, how can I help you today?',
        'That\'s an interesting question about philosophy.',
        'Let me tell you a story about a character named Error.',
        'Have you considered trying a different approach?'
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
  
  // Unit test for registerProblematicPersonality function
  describe('registerProblematicPersonality', () => {
    it('should register a new problematic personality', () => {
      registerProblematicPersonality('test-personality', {
        error: 'test_error',
        content: 'Test error content'
      });
      
      expect(runtimeProblematicPersonalities.has('test-personality')).toBe(true);
      
      const personalityInfo = runtimeProblematicPersonalities.get('test-personality');
      expect(personalityInfo.isProblematic).toBe(true);
      expect(personalityInfo.errorCount).toBe(1);
      expect(personalityInfo.lastErrorContent).toBe('Test error content');
      expect(personalityInfo.responses.length).toBeGreaterThan(0);
    });
    
    it('should not register a personality that is in the known list', () => {
      // Create a temporary mock for knownProblematicPersonalities
      const originalKnownProblematic = { ...knownProblematicPersonalities };
      const mockPersonality = 'known-problematic-personality';
      
      // Directly add a test personality to the knownProblematicPersonalities object
      knownProblematicPersonalities[mockPersonality] = {
        isProblematic: true,
        errorPatterns: ['Error'],
        responses: ['Fallback response']
      };
      
      registerProblematicPersonality(mockPersonality, {
        error: 'test_error',
        content: 'Test error content'
      });
      
      expect(runtimeProblematicPersonalities.has(mockPersonality)).toBe(false);
      
      // Clean up our mock
      delete knownProblematicPersonalities[mockPersonality];
      // Restore original values
      Object.keys(originalKnownProblematic).forEach(key => {
        knownProblematicPersonalities[key] = originalKnownProblematic[key];
      });
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
  });
  
  // Integration test for getAiResponse function
  describe('getAiResponse', () => {
    it('should return a response from the AI service', async () => {
      const personalityName = 'test-personality';
      const message = 'Hello, how are you?';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
      const response = await getAiResponse(personalityName, message, context);
      
      // Verify it returned a string
      expect(typeof response).toBe('string');
      expect(response.length).toBeGreaterThan(0);
      expect(response).toContain('This is a mock response');
    });
    
    it('should handle empty or missing messages', async () => {
      const personalityName = 'test-personality';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
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
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
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
    
    it('should check for blackout periods before making API calls', async () => {
      const personalityName = 'test-personality';
      const message = 'Test message';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
      // Add to blackout list
      addToBlackoutList(personalityName, context);
      
      const response = await getAiResponse(personalityName, message, context);
      expect(response).toBe('HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY');
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
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
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
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
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
    
    it('should register problematic personalities when they return errors', async () => {
      const personalityName = 'new-problematic-personality';
      const message = 'Test message';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
      // Get the mock AI client
      const openaiModule = require('openai');
      const OpenAI = openaiModule.OpenAI;
      const mockClient = new OpenAI();
      
      // Mock the client to return a response with an error pattern
      const createChatCompletionSpy = jest.spyOn(mockClient.chat.completions, 'create');
      createChatCompletionSpy.mockResolvedValueOnce({
        id: 'test-id',
        created: Date.now(),
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'TypeError: Cannot read property of undefined'
            },
            finish_reason: 'stop'
          }
        ]
      });
      
      const response = await getAiResponse(personalityName, message, context);
      
      // Verify the error response contains expected text pattern
      expect(response).toContain('technical issue');
      expect(response).toContain('Error ID:');
      
      // Verify the personality was registered as problematic
      expect(runtimeProblematicPersonalities.has(personalityName)).toBe(true);
      
      // Verify it was added to the blackout list
      const key = createBlackoutKey(personalityName, context);
      expect(errorBlackoutPeriods.has(key)).toBe(true);
      
      // Clean up spy
      createChatCompletionSpy.mockRestore();
    });
    
    it('should handle known problematic personalities with custom responses', async () => {
      const personalityName = 'lucifer-kochav-shenafal'; // Using real known problematic personality name
      const message = 'Test message';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      
      // Get the mock AI client
      const openaiModule = require('openai');
      const OpenAI = openaiModule.OpenAI;
      const mockClient = new OpenAI();
      
      // Mock the client to return a response with an error pattern
      const createChatCompletionSpy = jest.spyOn(mockClient.chat.completions, 'create');
      createChatCompletionSpy.mockResolvedValueOnce({
        id: 'test-id',
        created: Date.now(),
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'NoneType: None has no attribute'
            },
            finish_reason: 'stop'
          }
        ]
      });
      
      const response = await getAiResponse(personalityName, message, context);
      
      // Verify the response is one of the predefined fallback responses
      expect(knownProblematicPersonalities[personalityName].responses).toContain(response);
      
      // Verify it was added to the blackout list
      const key = createBlackoutKey(personalityName, context);
      expect(errorBlackoutPeriods.has(key)).toBe(true);
      
      // Clean up spy
      createChatCompletionSpy.mockRestore();
    });
  });
});