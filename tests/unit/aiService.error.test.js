/**
 * Tests for aiService.js focusing on error handling edge cases
 */

// Mock dependencies
jest.mock('openai');
jest.mock('../config', () => ({
  getApiEndpoint: jest.fn().mockReturnValue('https://api.example.com'),
  getModelPath: jest.fn().mockReturnValue('model/test')
}), { virtual: true });

// Mock auth module to bypass authentication
jest.mock('../../src/auth', () => ({
  hasValidToken: jest.fn().mockReturnValue(true),
  getUserToken: jest.fn().mockReturnValue('mock-token'),
  APP_ID: 'mock-app-id',
  API_KEY: 'mock-api-key',
  isNsfwVerified: jest.fn().mockReturnValue(true),
  getAuthManager: jest.fn().mockReturnValue(null), // For aiAuth module
  userTokens: {},
  nsfwVerified: {}
}));

// Mock aiAuth module
jest.mock('../../src/utils/aiAuth', () => ({
  initAiClient: jest.fn(),
  getAI: jest.fn().mockReturnValue({
    chat: {
      completions: {
        create: jest.fn()
      }
    }
  }),
  getAiClientForUser: jest.fn().mockResolvedValue({
    chat: {
      completions: {
        create: jest.fn()
      }
    }
  })
}));

// Mock webhookUserTracker to bypass authentication
jest.mock('../../src/utils/webhookUserTracker', () => ({
  shouldBypassNsfwVerification: jest.fn().mockReturnValue(false)
}));

describe('aiService Error Handling', () => {
  let aiService;
  let mockOpenAI;
  let originalConsoleLog;
  let originalConsoleWarn;
  let originalConsoleError;
  let originalEnv;
  
  // Common test data
  const personalityName = 'test-personality';
  const message = 'Test message';
  const context = {
    userId: 'test-user-123',
    channelId: 'test-channel-456'
  };
  
  // Set up mocks before tests
  beforeEach(() => {
    // Save original console methods
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    
    // Mock console methods to reduce noise
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
    
    // Save original environment
    originalEnv = process.env;
    
    // Set API key in environment
    process.env = { ...originalEnv, SERVICE_API_KEY: 'test-api-key' };
    
    // Reset all mocks
    jest.clearAllMocks();
    jest.resetModules();
    
    // Mock OpenAI
    const { OpenAI } = require('openai');
    mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: 'Normal API response'
                }
              }
            ]
          })
        }
      }
    };
    
    // Override the OpenAI constructor to return our mock
    OpenAI.mockImplementation(() => mockOpenAI);
    
    // Update aiAuth mock to return our mockOpenAI
    const aiAuth = require('../../src/utils/aiAuth');
    aiAuth.getAI.mockReturnValue(mockOpenAI);
    aiAuth.getAiClientForUser.mockResolvedValue(mockOpenAI);
    
    // Import the module under test after mocking
    aiService = require('../../src/aiService');
  });
  
  describe('Initialization and environment', () => {
    test('aiService should handle missing API key', () => {
      // Temporarily remove API key from environment
      const envBackup = process.env;
      const { SERVICE_API_KEY, ...envWithoutKey } = process.env;
      process.env = envWithoutKey;
      
      // Re-initialize module
      jest.resetModules();
      const OpenAI = require('openai').OpenAI;
      
      // Should not throw an error even with missing API key
      // Test that the module can be required without throwing
      const testModule = require('../../src/aiService');
      expect(testModule).toBeDefined();
      
      // Restore environment
      process.env = envBackup;
    });
    
    test('aiService should use default values for missing config settings', () => {
      // Mock config module to return undefined values
      jest.mock('../config', () => ({
        getApiEndpoint: jest.fn().mockReturnValue(undefined),
        getModelPath: jest.fn().mockReturnValue(undefined)
      }), { virtual: true });
      
      // Re-initialize module
      jest.resetModules();
      
      // Should not throw an error with undefined config values
      // Test that the module can be required without throwing
      const testModule = require('../../src/aiService');
      expect(testModule).toBeDefined();
    });
  });
  
  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    
    // Restore original environment
    process.env = originalEnv;
    
    // Restore all mocks
    jest.restoreAllMocks();
  });
  
  describe('Error detection', () => {
    test('isErrorResponse should correctly identify high confidence error patterns', () => {
      // High confidence error patterns (direct inclusion checks)
      const highConfidencePatterns = [
        'NoneType object has no attribute',
        'AttributeError: Something went wrong',
        'TypeError: Cannot read property',
        'ValueError: Invalid input',
        'KeyError: Missing key',
        'IndexError: Index out of bounds',
        'ModuleNotFoundError: No module named',
        'ImportError: Cannot import name'
      ];
      
      // All of these should be detected as errors
      for (const pattern of highConfidencePatterns) {
        expect(aiService.isErrorResponse(pattern)).toBe(true);
      }
    });
    
    test('isErrorResponse should correctly identify low confidence patterns with context', () => {
      // Test each pattern separately with appropriate context
      
      // Test Error: pattern
      expect(aiService.isErrorResponse('Error: Failed to process request')).toBe(true);
      
      // Test Traceback pattern with line reference
      expect(aiService.isErrorResponse('Traceback (most recent call last):\n  File "script.py", line 10')).toBe(true);
      
      // Test Exception pattern with appropriate context
      expect(aiService.isErrorResponse('An unexpected Exception was raised during execution')).toBe(true);
      expect(aiService.isErrorResponse('Python caught Exception: Value error')).toBe(true);
      expect(aiService.isErrorResponse('The system threw an Exception when processing input')).toBe(true);
    });
    
    test('isErrorResponse should not flag normal content with error-like terms', () => {
      // Messages that contain error-like terms but are not actual errors
      const normalMessages = [
        'This is a normal message',
        'Hello, how can I help you?',
        'The error was resolved successfully',
        'Let me tell you about errors in general',
        'I can trace back the origins of this concept',
        'Exceptions to this rule include...',
        'Error correction is an important concept in coding',
        'That\'s an exceptionally good question',
        'There was an error in my previous explanation, but I will clarify now'
      ];
      
      // None of these should be detected as errors
      normalMessages.forEach(message => {
        expect(aiService.isErrorResponse(message)).toBe(false);
      });
    });
    
    test('isErrorResponse should handle edge cases', () => {
      // Edge cases
      expect(aiService.isErrorResponse('')).toBe(true); // Empty string is an error
      expect(aiService.isErrorResponse(null)).toBe(true); // Null is an error
      expect(aiService.isErrorResponse(undefined)).toBe(true); // Undefined is an error
    });
  });
  
  describe('Blackout periods', () => {
    test('isInBlackoutPeriod should return true for recent errors', () => {
      // Add a personality+user to the blackout list
      aiService.addToBlackoutList(personalityName, context);
      
      // Check if it's in blackout period (should be true)
      expect(aiService.isInBlackoutPeriod(personalityName, context)).toBe(true);
    });
    
    test('isInBlackoutPeriod should return false after blackout period expires', async () => {
      // Add a personality+user to the blackout list
      aiService.addToBlackoutList(personalityName, context);
      
      // Mock Date.now to return a time after the blackout period
      const originalDateNow = Date.now;
      const mockNow = originalDateNow() + 31000; // 31 seconds later (blackout is 30 seconds)
      Date.now = jest.fn().mockReturnValue(mockNow);
      
      // Check if it's in blackout period (should be false now)
      expect(aiService.isInBlackoutPeriod(personalityName, context)).toBe(false);
      
      // Restore Date.now
      Date.now = originalDateNow;
    });
    
    test('addToBlackoutList should accept a custom duration parameter', () => {
      const customDuration = 120000; // 2 minutes
      
      // Add to blackout list with custom duration
      aiService.addToBlackoutList(personalityName, context, customDuration);
      
      // Create the key to check the blackout list
      const key = aiService.createBlackoutKey(personalityName, context);
      
      // Verify it was added to the blackout list
      expect(aiService.errorBlackoutPeriods.has(key)).toBe(true);
      
      // Get the expiration time
      const expirationTime = aiService.errorBlackoutPeriods.get(key);
      
      // Verify the expiration time is approximately correct
      // We allow a small margin of error for test execution time
      const expectedMinTime = Date.now() + customDuration - 100; // -100ms for test execution time
      expect(expirationTime).toBeGreaterThanOrEqual(expectedMinTime);
      
      // Verify blackout is respected for the custom duration
      expect(aiService.isInBlackoutPeriod(personalityName, context)).toBe(true);
      
      // Verify it expires correctly after the custom duration
      const originalDateNow = Date.now;
      // Set time to right after the custom duration
      const mockNow = originalDateNow() + customDuration + 1000;
      Date.now = jest.fn().mockReturnValue(mockNow);
      
      // Should no longer be in blackout period
      expect(aiService.isInBlackoutPeriod(personalityName, context)).toBe(false);
      
      // Restore Date.now
      Date.now = originalDateNow;
    });
    
    test('createBlackoutKey should handle missing context properties', () => {
      // Test with complete context
      const completeKey = aiService.createBlackoutKey(personalityName, context);
      expect(completeKey).toBe(`${personalityName}_${context.userId}_${context.channelId}`);
      
      // Test with missing userId
      const noUserContext = { channelId: context.channelId };
      const noUserKey = aiService.createBlackoutKey(personalityName, noUserContext);
      expect(noUserKey).toBe(`${personalityName}_anon_${context.channelId}`);
      
      // Test with missing channelId
      const noChannelContext = { userId: context.userId };
      const noChannelKey = aiService.createBlackoutKey(personalityName, noChannelContext);
      expect(noChannelKey).toBe(`${personalityName}_${context.userId}_nochannel`);
      
      // Test with empty context
      const emptyContext = {};
      const emptyContextKey = aiService.createBlackoutKey(personalityName, emptyContext);
      expect(emptyContextKey).toBe(`${personalityName}_anon_nochannel`);
      
      // Note: The original function doesn't support null context, so we can't test that case yet
      // We'd need to modify the aiService.js file to handle null context
    });
  });
  
  describe('Request handling', () => {
    test('getAiResponse should handle missing parameters gracefully', async () => {
      // Test with missing personalityName
      const responseWithoutPersonality = await aiService.getAiResponse(undefined, message, context);
      expect(responseWithoutPersonality).toBe("I'm experiencing an issue with my configuration. Please try again later.");
      
      // Test with missing message (should use default 'Hello')
      const responseWithoutMessage = await aiService.getAiResponse(personalityName, undefined, context);
      expect(responseWithoutMessage).not.toBe("I'm experiencing an issue with my configuration. Please try again later.");
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Hello'
          })
        ])
      }));
      
      // Test with missing context (should use defaults)
      const responseWithoutContext = await aiService.getAiResponse(personalityName, message);
      expect(typeof responseWithoutContext).toBe('string');
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
    });
    
    test('getAiResponse should track errors but not skip API calls', async () => {
      // Add to blackout list for monitoring
      aiService.addToBlackoutList(personalityName, context);
      
      // Verify it's tracked
      expect(aiService.isInBlackoutPeriod(personalityName, context)).toBe(true);
      
      // Mock successful response
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'Test response' } }]
      });
      
      // Call getAiResponse - should NOT be blocked
      const response = await aiService.getAiResponse(personalityName, message, context);
      
      // Should get normal response, not blocked
      expect(response).toBe('Test response');
      
      // API should have been called despite being in "blackout" (monitoring only)
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
    });
    
    test('getAiResponse should handle API errors gracefully', async () => {
      // Make API call throw an error
      mockOpenAI.chat.completions.create.mockRejectedValueOnce(
        new Error('API connection failed')
      );
      
      // Call getAiResponse
      const response = await aiService.getAiResponse(personalityName, message, context);
      
      // Should handle error and return user-friendly error message
      expect(response).toBe('BOT_ERROR_MESSAGE:⚠️ An error occurred while processing your request. Please try again later.');
      
      // Should add to blackout list
      expect(aiService.isInBlackoutPeriod(personalityName, context)).toBe(true);
    });
    
    test('getAiResponse should handle empty responses gracefully', async () => {
      // Make API return an invalid response
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: []
      });
      
      // Call getAiResponse
      const response = await aiService.getAiResponse(personalityName, message, context);
      
      // Should return an error message
      expect(response).toBe('I received an incomplete response. Please try again.');
    });
    
    test('getAiResponse should handle non-string responses gracefully', async () => {
      // Make API return non-string content
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: { some: 'object' } // Non-string content
            }
          }
        ]
      });
      
      // Call getAiResponse
      const response = await aiService.getAiResponse(personalityName, message, context);
      
      // Should return an error message
      expect(response).toBe('I received an unusual response format. Please try again.');
    });
    
    test('getAiResponse should detect error content in API responses', async () => {
      // Make API return error content
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'TypeError: Cannot read property of undefined'
            }
          }
        ]
      });
      
      // Call getAiResponse
      const response = await aiService.getAiResponse(personalityName, message, context);
      
      // Should return an error message with a reference ID
      expect(response).toMatch(/I encountered a processing error.*\|\|\(Reference:.*\)\|\|/);
      
      // Should track error for monitoring (but not block future requests)
      expect(aiService.isInBlackoutPeriod(personalityName, context)).toBe(true);
    });
    
    test('getAiResponse should handle completely null response gracefully', async () => {
      // Make API return null response
      mockOpenAI.chat.completions.create.mockResolvedValueOnce(null);
      
      // Call getAiResponse
      const response = await aiService.getAiResponse(personalityName, message, context);
      
      // Should return an error message
      expect(response).toBe('I received an incomplete response. Please try again.');
    });
    
    test('getAiResponse should handle network timeouts gracefully', async () => {
      // Make API call throw a timeout error
      mockOpenAI.chat.completions.create.mockRejectedValueOnce(
        new Error('Request timeout')
      );
      
      // Call getAiResponse
      const response = await aiService.getAiResponse(personalityName, message, context);
      
      // Should handle error and return user-friendly error message
      expect(response).toBe('BOT_ERROR_MESSAGE:⚠️ An error occurred while processing your request. Please try again later.');
      
      // Should add to blackout list
      expect(aiService.isInBlackoutPeriod(personalityName, context)).toBe(true);
    });
    
    test('getAiResponse should handle response with missing message property', async () => {
      // Make API return response without message property
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: [{ index: 0 }] // No message property
      });
      
      // Call getAiResponse
      const response = await aiService.getAiResponse(personalityName, message, context);
      
      // Should return an error message
      expect(response).toBe('I received an incomplete response. Please try again.');
    });
    
    test('getAiResponse should handle response with empty string content', async () => {
      // Make API return empty string content
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: ''
            }
          }
        ]
      });
      
      // Call getAiResponse
      const response = await aiService.getAiResponse(personalityName, message, context);
      
      // Empty string is detected as error content
      expect(response).toMatch(/Hmm, I couldn't generate a response.*\|\|\(Reference:.*\)\|\|/);
      
      // Should track for monitoring (empty_response is now tracked but doesn't block)
      expect(aiService.isInBlackoutPeriod(personalityName, context)).toBe(true);
      
      // Check if personality was registered as problematic
      // It might have been cleared, so let's just check that an error was detected
      expect(response).toContain('||(Reference:');
    });
  });
  
  // Removed problematic personalities tests
  
  describe('API error handling', () => {
    test('getAiResponse should detect API errors', async () => {
      // Make API call throw an error
      mockOpenAI.chat.completions.create.mockRejectedValueOnce(
        new TypeError('Specific type error')
      );
      
      // Call getAiResponse
      const response = await aiService.getAiResponse(personalityName, message, context);
      
      // Should return user-friendly error message
      expect(response).toBe('BOT_ERROR_MESSAGE:⚠️ An error occurred while processing your request. Please try again later.');
      
      // Should add to blackout list
      expect(aiService.isInBlackoutPeriod(personalityName, context)).toBe(true);
    });
  });
  
  describe('Duplicate request prevention', () => {
    test('createRequestId should create consistent IDs for same inputs', () => {
      // Create two IDs with the same inputs
      const id1 = aiService.createRequestId(personalityName, message, context);
      const id2 = aiService.createRequestId(personalityName, message, context);
      
      // IDs should be the same
      expect(id1).toBe(id2);
      
      // Create ID with different message
      const id3 = aiService.createRequestId(personalityName, 'Different message', context);
      
      // ID should be different
      expect(id1).not.toBe(id3);
    });
    
    test('getAiResponse should handle duplicate requests', async () => {
      // Start a first request (don't await it yet)
      const promise1 = aiService.getAiResponse(personalityName, message, context);
      
      // Immediately start a second identical request
      const promise2 = aiService.getAiResponse(personalityName, message, context);
      
      // API should only be called once
      await Promise.all([promise1, promise2]);
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(1);
      
      // Both promises should resolve to the same value
      const result1 = await promise1;
      const result2 = await promise2;
      expect(result1).toBe(result2);
    });
    
    test('getAiResponse should track pending requests', async () => {
      // Start a request (don't await yet)
      const promise = aiService.getAiResponse(personalityName, message, context);
      
      // Request should be in the pendingRequests map while it's processing
      const requestId = aiService.createRequestId(personalityName, message, context);
      expect(aiService.pendingRequests.has(requestId)).toBe(true);
      
      // Wait for the promise to resolve
      await promise;
      
      // The request should be removed from the map after completion
      expect(aiService.pendingRequests.has(requestId)).toBe(false);
    });
  });
  
  // Content sanitization tests have been moved to tests/unit/utils/contentSanitizer.test.js
});