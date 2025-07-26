/* eslint-disable max-lines */
const aiService = require('../../src/aiService');
const {
  getAiResponse,
  isErrorResponse,
  createRequestId,
  isInBlackoutPeriod,
  addToBlackoutList,
  createBlackoutKey,
  errorBlackoutPeriods,
  pendingRequests,
} = aiService;

// Constants are imported but not used in this test file

// Mock webhookUserTracker to bypass authentication
jest.mock('../../src/utils/webhookUserTracker', () => ({
  shouldBypassNsfwVerification: jest.fn().mockReturnValue(true), // Return true to bypass auth in tests
}));

// Mock ApplicationBootstrap for DDD authentication and personalities
const mockDDDAuthService = {
  getAuthenticationStatus: jest.fn(),
  createAIClient: jest.fn(),
};

const mockPersonalityApplicationService = {
  getPersonality: jest.fn(),
};

jest.mock('../../src/application/bootstrap/ApplicationBootstrap', () => ({
  getApplicationBootstrap: jest.fn(() => ({
    getApplicationServices: jest.fn(() => ({
      authenticationService: mockDDDAuthService,
    })),
    getPersonalityApplicationService: jest.fn(() => mockPersonalityApplicationService),
  })),
}));


// Mock FeatureFlags module
jest.mock('../../src/application/services/FeatureFlags', () => ({
  createFeatureFlags: jest.fn().mockReturnValue({
    isEnabled: jest.fn().mockReturnValue(false),
  }),
}));

// Mock PersonalityDataService module
jest.mock('../../src/services/PersonalityDataService', () => ({
  getPersonalityDataService: jest.fn().mockReturnValue({
    hasBackupData: jest.fn().mockReturnValue(false),
    buildContextualPrompt: jest.fn(),
  }),
}));

// Mock OpenAI module
jest.mock('openai', () => {
  // Create a mock AI client
  const mockAIClient = {
    setShouldError: jest.fn().mockImplementation(function (shouldError) {
      this.shouldError = shouldError;
    }),

    setErrorMessage: jest.fn().mockImplementation(function (message) {
      this.errorMessage = message;
    }),

    chat: {
      completions: {
        create: jest.fn().mockImplementation(async function (params) {
          // Check if we should return an error
          if (mockAIClient.shouldError) {
            throw new Error(mockAIClient.errorMessage || 'Mock API error');
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
                  content: `This is a mock response from personality: ${params.model}. Hello there!`,
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 200,
              total_tokens: 300,
            },
          };
        }),
      },
    },
  };

  return {
    OpenAI: jest.fn().mockImplementation(() => mockAIClient),
  };
});

// Mock config module
jest.mock('../../config', () => ({
  getApiEndpoint: jest.fn().mockReturnValue('https://example.com/api'),
  getModelPath: jest.fn().mockReturnValue('mock-model-path'),
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@',
  },
}));

// Import botPrefix from the mocked config
const { botPrefix } = require('../../config');

describe('AI Service', () => {
  // Save original environment variables
  const originalEnv = process.env;
  
  // Helper to create context with webhook bypass
  const createTestContext = (userId = 'user-123', channelId = 'channel-456') => ({
    userId,
    channelId,
    // Add webhook context to bypass authentication in tests
    message: {
      webhookId: 'test-webhook',
      author: { username: 'TestWebhook' }
    }
  });

  // Save original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  beforeEach(() => {
    // Mock environment variables
    process.env = { ...originalEnv, SERVICE_API_KEY: 'mock-api-key' };

    // Mock console methods to prevent noise during tests
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();

    // Use fake timers properly
    jest.useFakeTimers();

    // Clear all tracking maps
    pendingRequests.clear();
    errorBlackoutPeriods.clear();
    
    // Set up default mock responses
    mockDDDAuthService.getAuthenticationStatus.mockResolvedValue({
      isAuthenticated: true,
      user: { 
        nsfwStatus: { verified: true },
        token: {
          value: 'mock-token'
        }
      }
    });
    
    mockPersonalityApplicationService.getPersonality.mockResolvedValue({
      name: 'test-personality',
      profile: {
        name: 'test-personality',
        displayName: 'Test Personality',
      },
    });
    
    // Mock getAiClientForUser to return a valid client by default
    const openaiModule = require('openai');
    const OpenAI = openaiModule.OpenAI;
    const mockClient = new OpenAI();
    aiService.getAiClientForUser = jest.fn().mockResolvedValue(mockClient);
  });

  afterEach(() => {
    // Restore environment variables
    process.env = originalEnv;

    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    // Restore real timers
    jest.useRealTimers();

    // Restore all mocks
    jest.restoreAllMocks();

    // Clear mocks
    jest.clearAllMocks();
  });

  // Unit test for isErrorResponse function
  describe('isErrorResponse', () => {
    it('should return true for high confidence error patterns', async () => {
      const highConfidenceErrors = [
        'NoneType object has no attribute',
        'AttributeError occurred in processing',
        'TypeError: cannot access property',
        'ValueError: invalid value provided',
        'KeyError: key not found in dictionary',
        'IndexError: list index out of range',
        'ModuleNotFoundError: No module named',
        'ImportError: cannot import name',
      ];

      // Test each error pattern individually
      for (const errorPattern of highConfidenceErrors) {
        expect(isErrorResponse(errorPattern)).toBe(true);
      }
    });

    it('should return true for low confidence patterns with sufficient context', async () => {
      const contextualErrors = [
        'Error: something went wrong with the connection',
        'Traceback (most recent call last):\n  File "app.py", line 42',
        'An Exception was raised during execution',
        'Python Exception was caught: Invalid syntax',
        'Exception thrown while processing request',
      ];

      for (const message of contextualErrors) {
        expect(isErrorResponse(message)).toBe(true);
      }
    });

    it('should return false for normal responses even with error-like terms', async () => {
      const normalResponses = [
        'Hello, how can I help you today?',
        "That's an interesting question about philosophy.",
        'Let me tell you a story about a character named Error.',
        'The Exception proves the rule in this case.',
        'I traced back the origins of this concept to ancient Greece.',
        'Error detection and correction is an important topic in computer science.',
        'Errorless learning is a training technique used in psychology.',
        'The exceptional quality of their work stands out.',
        'There was an error in my previous understanding, but now I see clearly.',
      ];

      for (const message of normalResponses) {
        expect(isErrorResponse(message)).toBe(false);
      }
    });

    it('should return true for empty or null content', async () => {
      expect(isErrorResponse('')).toBe(true);
      expect(isErrorResponse(null)).toBe(true);
      expect(isErrorResponse(undefined)).toBe(true);
    });
  });

  // Unit test for createBlackoutKey and blackout period functions
  describe('Blackout Period Management', () => {
    it('should create a unique blackout key for a personality-user-channel combination', async () => {
      const personalityName = 'test-personality';
      const context = { userId: 'user-123', channelId: 'channel-456' };

      const key = createBlackoutKey(personalityName, context);
      expect(key).toBe('test-personality_user-123_channel-456');
    });

    it('should handle missing userId or channelId in context', async () => {
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

    it('should add a personality to the blackout list', async () => {
      const personalityName = 'test-personality';
      const context = { userId: 'user-123', channelId: 'channel-456' };

      addToBlackoutList(personalityName, context);

      const key = createBlackoutKey(personalityName, context);
      expect(errorBlackoutPeriods.has(key)).toBe(true);

      const expirationTime = errorBlackoutPeriods.get(key);
      expect(expirationTime).toBeGreaterThan(Date.now());
    });

    it('should accept a custom duration when adding to blackout list', async () => {
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

    it('should detect when a personality is in a blackout period', async () => {
      const personalityName = 'test-personality';
      const context = { userId: 'user-123', channelId: 'channel-456' };
      const key = createBlackoutKey(personalityName, context);

      // Add to blackout list with a future expiration
      errorBlackoutPeriods.set(key, Date.now() + 10000);
      expect(isInBlackoutPeriod(personalityName, context)).toBe(true);
    });

    it('should detect when a personality is not in a blackout period', async () => {
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

    it('should format a simple string message correctly', async () => {
      const message = 'Hello, how are you?';
      const formattedMessages = await formatApiMessages(message);

      expect(formattedMessages).toEqual([{ role: 'user', content: message }]);
    });

    it('should handle multimodal content array with image', async () => {
      const multimodalContent = [
        {
          type: 'text',
          text: 'What is in this image?',
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/image.jpg',
          },
        },
      ];

      const formattedMessages = await formatApiMessages(multimodalContent);

      expect(formattedMessages).toEqual([{ role: 'user', content: multimodalContent }]);
    });

    it('should handle multimodal content array with audio', async () => {
      const multimodalContent = [
        {
          type: 'text',
          text: 'Please transcribe this audio file',
        },
        {
          type: 'audio_url',
          audio_url: {
            url: 'https://example.com/audio.mp3',
          },
        },
      ];

      const formattedMessages = await formatApiMessages(multimodalContent);

      expect(formattedMessages).toEqual([{ role: 'user', content: multimodalContent }]);
    });

    it('should not modify content array structure', async () => {
      const multimodalContent = [
        { type: 'text', text: 'Text content' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
      ];

      const formattedMessages = await formatApiMessages(multimodalContent);

      // Verify that the content array structure is preserved
      expect(formattedMessages[0].content).toBe(multimodalContent);
      expect(formattedMessages[0].content[0].type).toBe('text');
      expect(formattedMessages[0].content[1].type).toBe('image_url');
    });

    it('should preserve audio content in multimodal array', async () => {
      const multimodalContent = [
        { type: 'text', text: 'Transcribe this' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
      ];

      const formattedMessages = await formatApiMessages(multimodalContent);

      // Verify that the audio content structure is preserved
      expect(formattedMessages[0].content).toBe(multimodalContent);
      expect(formattedMessages[0].content[0].type).toBe('text');
      expect(formattedMessages[0].content[1].type).toBe('audio_url');
      expect(formattedMessages[0].content[1].audio_url.url).toBe('https://example.com/audio.mp3');
    });

    // PluralKit speaker identification tests
    it('should add speaker identification for PluralKit messages', async () => {
      const message = 'Hello from PluralKit!';
      const personalityName = 'test-personality';
      const userName = 'Alice | Wonderland System';
      const isProxyMessage = true;

      const formattedMessages = await formatApiMessages(
        message,
        personalityName,
        userName,
        isProxyMessage
      );

      expect(formattedMessages).toEqual([
        { role: 'user', content: 'Alice | Wonderland System: Hello from PluralKit!' },
      ]);
    });

    it('should NOT add speaker identification for regular users', async () => {
      const message = 'Hello from regular user!';
      const personalityName = 'test-personality';
      const userName = 'Bob (bob123)';
      const isProxyMessage = false;

      const formattedMessages = await formatApiMessages(
        message,
        personalityName,
        userName,
        isProxyMessage
      );

      expect(formattedMessages).toEqual([{ role: 'user', content: 'Hello from regular user!' }]);
    });

    it('should add speaker identification to multimodal PluralKit messages', async () => {
      const multimodalContent = [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ];
      const personalityName = 'test-personality';
      const userName = 'Charlie | Rainbow System';
      const isProxyMessage = true;

      const formattedMessages = await formatApiMessages(
        multimodalContent,
        personalityName,
        userName,
        isProxyMessage
      );

      expect(formattedMessages).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Charlie | Rainbow System: What is this?' },
            { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
          ],
        },
      ]);
    });

    it('should NOT add speaker identification to multimodal regular user messages', async () => {
      const multimodalContent = [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ];
      const personalityName = 'test-personality';
      const userName = 'Dave (dave123)';
      const isProxyMessage = false;

      const formattedMessages = await formatApiMessages(
        multimodalContent,
        personalityName,
        userName,
        isProxyMessage
      );

      expect(formattedMessages).toEqual([{ role: 'user', content: multimodalContent }]);
    });

    it('should handle default userName parameter correctly', async () => {
      const message = 'Test message';
      const personalityName = 'test-personality';
      // Not passing userName, should default to 'a user'

      const formattedMessages = await formatApiMessages(message, personalityName);

      expect(formattedMessages).toEqual([{ role: 'user', content: 'Test message' }]);
    });
  });

  // Unit test for createRequestId function
  describe('createRequestId', () => {
    it('should create a unique request ID for tracking API requests', async () => {
      const personalityName = 'test-personality';
      const message = 'This is a test message';
      const context = { userId: 'user-123', channelId: 'channel-456' };

      const requestId = createRequestId(personalityName, message, context);
      // Now includes hash for better uniqueness
      expect(requestId).toMatch(/^test-personality_user-123_channel-456_Thisisatestmessage_h\d+$/);
    });

    it('should handle long messages by truncating to 50 characters', async () => {
      const personalityName = 'test-personality';
      const message =
        'This is a very long message that should be truncated to only 50 characters now';
      const context = { userId: 'user-123', channelId: 'channel-456' };

      const requestId = createRequestId(personalityName, message, context);
      // Now truncates to 50 chars and includes hash
      expect(requestId).toMatch(
        /^test-personality_user-123_channel-456_Thisisaverylongmessagethatshouldbetruncat_h\d+$/
      );
    });

    it('should handle missing context values', async () => {
      const personalityName = 'test-personality';
      const message = 'Test message';

      // Missing both
      let requestId = createRequestId(personalityName, message, {});
      expect(requestId).toMatch(/^test-personality_anon_nochannel_Testmessage_h\d+$/);

      // Missing channelId
      requestId = createRequestId(personalityName, message, { userId: 'user-123' });
      expect(requestId).toMatch(/^test-personality_user-123_nochannel_Testmessage_h\d+$/);

      // Missing userId
      requestId = createRequestId(personalityName, message, { channelId: 'channel-456' });
      expect(requestId).toMatch(/^test-personality_anon_channel-456_Testmessage_h\d+$/);
    });

    it('should handle multimodal content arrays with images', async () => {
      const personalityName = 'test-personality';
      const multimodalContent = [
        {
          type: 'text',
          text: 'What is in this image?',
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/image.jpg',
          },
        },
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

    it('should handle multimodal content arrays with audio', async () => {
      const personalityName = 'test-personality';
      const multimodalContent = [
        {
          type: 'text',
          text: 'Please transcribe this audio',
        },
        {
          type: 'audio_url',
          audio_url: {
            url: 'https://example.com/audio.mp3',
          },
        },
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
          text: 'Please transcribe this audio', // Same text
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/image.jpg',
          },
        },
      ];

      const imageRequestId = createRequestId(personalityName, imageContent, context);
      expect(imageRequestId).not.toBe(requestId);
    });
  });

  // Integration test for getAiResponse function
  describe('getAiResponse', () => {
    let mockClient;
    
    beforeEach(() => {
      // Reset DDD auth mock to ensure authentication passes
      mockDDDAuthService.getAuthenticationStatus.mockResolvedValue({
        isAuthenticated: true,
        user: { 
          nsfwStatus: { verified: true },
          token: {
            value: 'mock-token'
          }
        }
      });
      
      // Ensure AI client is properly mocked
      const openaiModule = require('openai');
      const OpenAI = openaiModule.OpenAI;
      mockClient = new OpenAI();
      
      // Mock createAIClient to return the mock client
      mockDDDAuthService.createAIClient.mockResolvedValue(mockClient);
      
      // Reset the mock to return proper responses
      mockClient.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'This is a mock response',
            },
          },
        ],
      });
      
      // Legacy authManager removed - DDD authentication handles this
    });

    it('should return a response from the AI service', async () => {
      const personalityName = 'test-personality';
      const message = 'Hello, how are you?';
      const context = {
        userId: 'user-123',
        channelId: 'channel-456',
        userName: 'Test User (testuser)',
      };

      const response = await getAiResponse(personalityName, message, context);

      // Verify it returned an object with content and metadata
      expect(response).toHaveProperty('content');
      expect(response).toHaveProperty('metadata');
      expect(typeof response.content).toBe('string');
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.content).toContain('This is a mock response');
    });

    it('should handle empty or missing messages', async () => {
      const personalityName = 'test-personality';
      const context = {
        userId: 'user-123',
        channelId: 'channel-456',
        userName: 'Test User (testuser)',
      };

      // Mock logger.warn
      const logger = require('../../src/logger');
      const originalLoggerWarn = logger.warn;
      logger.warn = jest.fn();

      // Empty message
      let response = await getAiResponse(personalityName, '', context);
      expect(response).toHaveProperty('content');
      expect(response).toHaveProperty('metadata');
      expect(typeof response.content).toBe('string');
      expect(response.content.length).toBeGreaterThan(0);

      // Undefined message
      response = await getAiResponse(personalityName, undefined, context);
      expect(response).toHaveProperty('content');
      expect(response).toHaveProperty('metadata');
      expect(typeof response.content).toBe('string');
      expect(response.content.length).toBeGreaterThan(0);

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
        userName: 'Test User (testuser)',
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
        userName: 'Test User (testuser)',
      };

      // Add to blackout list for monitoring
      addToBlackoutList(personalityName, context);

      // Verify it's tracked
      expect(isInBlackoutPeriod(personalityName, context)).toBe(true);

      // API call should still go through
      const response = await getAiResponse(personalityName, message, context);
      expect(response).toHaveProperty('content');
      expect(response.content).toContain('This is a mock response');
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
        userName: 'Test User (testuser)',
      };

      // Manually add a pending request to the map to simulate a request in progress
      const requestId = createRequestId(personalityName, message, context);
      pendingRequests.set(requestId, {
        timestamp: Date.now(),
        promise: Promise.resolve('Mock API response'),
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
        userName: 'Test User (testuser)',
      };

      // Mock the AI client to throw an error
      const openaiModule = require('openai');
      const OpenAI = openaiModule.OpenAI;
      const mockClient = new OpenAI();

      // Make the create method throw an error
      mockClient.chat.completions.create.mockRejectedValue(new Error('Mock API error'));
      aiService.getAiClientForUser.mockResolvedValue(mockClient);

      const response = await getAiResponse(personalityName, message, context);

      // Verify we get the user-friendly error message
      expect(response).toHaveProperty('content');
      expect(response).toHaveProperty('metadata', null);
      expect(response.content).toMatch(/.*\|\|\*\(Error ID: \w+\)\*\|\|$/);

      // Verify the personality was added to the blackout list
      const key = createBlackoutKey(personalityName, context);
      expect(errorBlackoutPeriods.has(key)).toBe(true);
    });

    it('should respect enhanced context feature flag', async () => {
      const personalityName = 'test-personality';
      const message = 'Test message';
      const context = {
        userId: 'user-123',
        channelId: 'channel-456',
      };

      // Set up mocks
      const openaiModule = require('openai');
      const { createFeatureFlags } = require('../../src/application/services/FeatureFlags');
      const { getPersonalityDataService } = require('../../src/services/PersonalityDataService');

      const OpenAI = openaiModule.OpenAI;
      const mockClient = new OpenAI();

      mockClient.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Test response',
            },
          },
        ],
      });

      aiService.getAiClientForUser.mockResolvedValue(mockClient);

      // Test with feature flag disabled (default)
      await getAiResponse(personalityName, message, context);

      // Should not check for backup data when flag is disabled
      expect(getPersonalityDataService().hasBackupData).not.toHaveBeenCalled();

      // Now enable the feature flag
      createFeatureFlags().isEnabled.mockReturnValue(true);
      getPersonalityDataService().hasBackupData.mockResolvedValue(true);
      getPersonalityDataService().buildContextualPrompt.mockResolvedValue({
        messages: [
          { role: 'system', content: 'Enhanced prompt' },
          { role: 'user', content: message },
        ],
        context: { history: [{ role: 'user', content: 'Previous message' }] },
        hasExtendedContext: true,
      });

      // Clear previous calls
      jest.clearAllMocks();
      
      // Mock DDD auth to return authenticated user with token
      mockDDDAuthService.getAuthenticationStatus.mockResolvedValue({
        isAuthenticated: true,
        user: { token: { value: 'test-token' }, nsfwStatus: { verified: true } }
      });
      
      // Mock getAiClientForUser on the aiService module
      aiService.getAiClientForUser = jest.fn().mockResolvedValue(mockClient);
      
      mockClient.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Enhanced response',
            },
          },
        ],
      });

      // Test with feature flag enabled
      await getAiResponse(personalityName, message, context);

      // Should check for backup data when flag is enabled
      expect(getPersonalityDataService().hasBackupData).toHaveBeenCalledWith(personalityName);
      expect(getPersonalityDataService().buildContextualPrompt).toHaveBeenCalledWith(
        personalityName,
        'user-123',
        message,
        expect.objectContaining({ prompt: null })
      );
    });
  });

  describe('Additional Coverage Tests', () => {
    beforeEach(() => {
      jest.clearAllMocks();

      // Legacy authManager removed - DDD authentication handles this

      // Reset default mock implementations
      const openaiModule = require('openai');
      const OpenAI = openaiModule.OpenAI;
      const mockClient = new OpenAI();

      // Ensure the mock client returns proper responses
      mockClient.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'This is a mock response',
            },
          },
        ],
      });

      aiService.getAiClientForUser.mockResolvedValue(mockClient);

      const webhookUserTracker = require('../../src/utils/webhookUserTracker');
      webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(false);
    });


    it('should bypass authentication for recognized webhook users', async () => {
      const context = {
        userId: 'webhook-user-123',
        channelId: 'test-channel',
        message: {
          webhookId: 'webhook-123',
          author: { username: 'PluralKit' },
        },
      };

      const webhookUserTracker = require('../../src/utils/webhookUserTracker');
      webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(true);

      const response = await getAiResponse('test-personality', 'Hello', context);

      expect(webhookUserTracker.shouldBypassNsfwVerification).toHaveBeenCalledWith(context.message);
      expect(response).toHaveProperty('content');
      expect(response.content).toContain('This is a mock response');
    });

    it('should handle authentication required errors from API', async () => {
      const personalityName = 'test-personality';
      const message = 'Test message';
      const context = {
        userId: 'user-123',
        channelId: 'channel-456',
      };

      // Mock the AI client to throw authentication error
      const openaiModule = require('openai');
      const OpenAI = openaiModule.OpenAI;
      const mockClient = new OpenAI();

      const authError = new Error('Authentication required');
      mockClient.chat.completions.create.mockRejectedValue(authError);
      
      // Mock getAiClientForUser on the aiService module
      aiService.getAiClientForUser = jest.fn().mockResolvedValue(mockClient);

      const response = await getAiResponse(personalityName, message, context);

      expect(response).toBe(
        `BOT_ERROR_MESSAGE:⚠️ Authentication required. Please use \`${botPrefix} auth start\` to begin authentication.`
      );
    });

    it('should handle errors when logging message content fails', async () => {
      const complexMessage = {
        messageContent: {
          circular: null,
        },
      };
      // Create circular reference
      complexMessage.messageContent.circular = complexMessage.messageContent;

      const personalityName = 'test-personality';
      const context = {
        userId: 'user-123',
        channelId: 'channel-456',
      };

      // Force an error by making the AI call fail
      const openaiModule = require('openai');
      const OpenAI = openaiModule.OpenAI;
      const mockClient = new OpenAI();

      mockClient.chat.completions.create.mockRejectedValue(new Error('Test error'));
      
      // Mock getAiClientForUser on the aiService module
      aiService.getAiClientForUser = jest.fn().mockResolvedValue(mockClient);

      // Mock JSON.stringify to throw for circular reference
      const originalStringify = JSON.stringify;
      JSON.stringify = jest.fn().mockImplementation(obj => {
        if (obj === complexMessage.messageContent) {
          throw new Error('Converting circular structure to JSON');
        }
        return originalStringify(obj);
      });

      const response = await getAiResponse(personalityName, complexMessage, context);

      expect(response).toHaveProperty('content');
      expect(response).toHaveProperty('metadata', null);
      expect(response.content).toMatch(/.*\|\|\*\(Error ID: \w+\)\*\|\|$/);

      // Restore
      JSON.stringify = originalStringify;
    });

    it('should log reference with webhook name when available', async () => {
      const message = {
        messageContent: 'Reply text',
        referencedMessage: {
          content: 'Original message',
          webhookName: 'TestWebhook',
        },
      };

      const response = await getAiResponse('test-personality', message, {
        userId: 'test-user',
        channelId: 'test-channel',
      });

      expect(response).toHaveProperty('content');
      expect(response.content).toContain('This is a mock response');
    });

    it('should log reference with author when no personality or webhook name', async () => {
      const message = {
        messageContent: 'Reply text',
        referencedMessage: {
          content: 'Original message',
          author: 'TestUser',
        },
      };

      const response = await getAiResponse('test-personality', message, {
        userId: 'test-user',
        channelId: 'test-channel',
      });

      expect(response).toHaveProperty('content');
      expect(response.content).toContain('This is a mock response');
    });

    it('should log reference as unknown-source when no identifying info', async () => {
      const message = {
        messageContent: 'Reply text',
        referencedMessage: {
          content: 'Original message',
        },
      };

      const response = await getAiResponse('test-personality', message, {
        userId: 'test-user',
        channelId: 'test-channel',
      });

      expect(response).toHaveProperty('content');
      expect(response.content).toContain('This is a mock response');
    });

    it('should handle errors when logging reference details', async () => {
      const message = {
        messageContent: { complex: 'object' },
        referencedMessage: {
          content: null, // This will cause substring() to fail
          personalityName: 'TestPersonality',
        },
      };

      const response = await getAiResponse('test-personality', message, {
        userId: 'test-user',
        channelId: 'test-channel',
      });

      expect(response).toHaveProperty('content');
      expect(response.content).toContain('This is a mock response');
    });

    it('should throw error when AI client is not available', async () => {
      // Mock the DDD auth service to return authenticated user without token
      mockDDDAuthService.getAuthenticationStatus.mockResolvedValue({
        isAuthenticated: true,
        user: { 
          nsfwStatus: { verified: true }
          // No token property - this will cause getAiClientForUser to return null
        }
      });

      const response = await getAiResponse('test-personality', 'Hello', {
        userId: 'test-user',
        channelId: 'test-channel',
        // Add webhook context to bypass initial auth check
        message: {
          webhookId: 'test-webhook',
          author: { username: 'TestWebhook' }
        }
      });

      // When AI client is null due to missing token, the error is caught and returns auth error
      expect(response).toBe(
        `BOT_ERROR_MESSAGE:⚠️ Authentication required. Please use \`${botPrefix} auth start\` to begin authentication.`
      );
    });



    it('should handle invalid response structure', async () => {
      const personalityName = 'test-personality';
      const message = 'Test message';
      const context = {
        userId: 'user-123',
        channelId: 'channel-456',
      };

      // Mock AI client to return invalid structure
      const openaiModule = require('openai');
      const OpenAI = openaiModule.OpenAI;
      const mockClient = new OpenAI();

      mockClient.chat.completions.create.mockResolvedValue({
        // Missing choices array
        id: 'test-id',
      });

      const response = await getAiResponse(personalityName, message, context);

      // Should use personality error handler for invalid response
      expect(response).toHaveProperty('content');
      expect(response).toHaveProperty('metadata');
      expect(response.content).toMatch(/Hmm, I couldn't generate a response.*\|\|\(Reference:.*\)\|\|/);
    });

    it('should handle non-string content from AI', async () => {
      const personalityName = 'test-personality';
      const message = 'Test message';
      const context = {
        userId: 'user-123',
        channelId: 'channel-456',
      };

      // Mock AI client to return non-string content
      const openaiModule = require('openai');
      const OpenAI = openaiModule.OpenAI;
      const mockClient = new OpenAI();

      mockClient.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: { unexpected: 'object' }, // Non-string content
            },
          },
        ],
      });

      const response = await getAiResponse(personalityName, message, context);

      // Should use personality error handler for non-string content
      expect(response).toHaveProperty('content');
      expect(response).toHaveProperty('metadata');
      expect(response.content).toMatch(/I couldn't process that request.*\|\|\(Reference:.*\)\|\|/);
    });
  });
});
