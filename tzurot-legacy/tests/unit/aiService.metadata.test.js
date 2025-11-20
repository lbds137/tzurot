// Mock modules before imports
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../../src/profileInfoFetcher');
jest.mock('../../src/utils/aiErrorHandler', () => ({
  isErrorResponse: jest.fn().mockReturnValue(false),
  analyzeErrorAndGenerateMessage: jest.fn(),
  handleApiError: jest.fn(),
}));
jest.mock('../../src/application/bootstrap/ApplicationBootstrap');
jest.mock('../../src/utils/aiRequestManager', () => ({
  getPendingRequest: jest.fn().mockReturnValue(null),
  storePendingRequest: jest.fn(),
  removePendingRequest: jest.fn(),
  createRequestId: jest.fn((personality, message, context) => `${personality}-${message}-${context.userId}`),
  addToBlackoutList: jest.fn(),
  prepareRequestHeaders: jest.fn().mockReturnValue({}),
}));
jest.mock('../../src/utils/webhookUserTracker', () => ({
  shouldBypassNsfwVerification: jest.fn().mockReturnValue(true), // Return true to bypass auth
}));
jest.mock('../../config', () => ({
  getModelPath: jest.fn((name) => `models/${name}`),
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
  },
}));
jest.mock('../../src/services/PersonalityDataService', () => ({
  getPersonalityDataService: jest.fn().mockReturnValue({
    hasBackupData: jest.fn().mockResolvedValue(false),
  }),
}));

const aiService = require('../../src/aiService');
const { getAiResponse } = aiService;
const _logger = require('../../src/logger');
const { analyzeErrorAndGenerateMessage } = require('../../src/utils/aiErrorHandler');
const { getApplicationBootstrap } = require('../../src/application/bootstrap/ApplicationBootstrap');

// Mock aiMessageFormatter
jest.mock('../../src/utils/aiMessageFormatter', () => ({
  formatApiMessages: jest.fn().mockImplementation((message) => {
    return [{ role: 'user', content: message }];
  }),
}));

// Mock the feature flags with a function that returns the mock
jest.mock('../../src/application/services/FeatureFlags', () => ({
  createFeatureFlags: jest.fn(() => ({
    isEnabled: jest.fn().mockReturnValue(false),
  })),
}));

// No need to mock OpenAI directly since we mock authService

describe('AI Service - Metadata Support', () => {
  let mockOpenAIClient;
  let mockCreateCompletion;
  let mockAuthService;
  let mockPersonalityApplicationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateCompletion = jest.fn();
    mockOpenAIClient = {
      chat: {
        completions: {
          create: mockCreateCompletion,
        },
      },
    };

    // Mock auth service
    mockAuthService = {
      getAuthenticationStatus: jest.fn().mockResolvedValue({
        isAuthenticated: true,
        user: {
          id: 'test-user',
          token: { value: 'test-token' },
        },
      }),
      createAIClient: jest.fn().mockResolvedValue(mockOpenAIClient),
    };

    // Mock personality router
    mockPersonalityApplicationService = {
      getPersonality: jest.fn().mockResolvedValue({
        fullName: 'test-personality',
        profile: {
          displayName: 'Test Personality',
          errorMessage: 'Error occurred',
        },
      }),
    };

    // Mock application bootstrap
    getApplicationBootstrap.mockReturnValue({
      getApplicationServices: jest.fn().mockReturnValue({
        authenticationService: mockAuthService,
      }),
      getPersonalityApplicationService: jest.fn().mockReturnValue(mockPersonalityApplicationService),
    });

    // Mock getAiClientForUser to return our mock client
    aiService.getAiClientForUser = jest.fn().mockResolvedValue(mockOpenAIClient);
  });

  describe('Metadata extraction', () => {
    it('should return metadata when present in API response', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Hello from the AI!',
            },
          },
        ],
        usage: {
          metadata: {
            fallback_model_used: false,
            is_premium: true,
            zero_balance_diverted: false,
          },
        },
      };

      mockCreateCompletion.mockResolvedValue(mockResponse);

      const result = await getAiResponse('test-personality', 'Hello AI', {
        userId: 'test-user',
        channelId: 'test-channel',
        // Add webhook context to bypass authentication
        message: {
          webhookId: 'test-webhook',
          author: { username: 'TestWebhook' }
        }
      });

      expect(mockCreateCompletion).toHaveBeenCalled();

      expect(result).toEqual({
        content: 'Hello from the AI!',
        metadata: {
          fallback_model_used: false,
          is_premium: true,
          zero_balance_diverted: false,
        },
      });
    });

    it('should return null metadata when not present in API response', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Hello from the AI!',
            },
          },
        ],
        usage: {
          completion_tokens: 10,
          prompt_tokens: 20,
        },
      };

      mockCreateCompletion.mockResolvedValue(mockResponse);

      const result = await getAiResponse('test-personality', 'Hello AI', {
        userId: 'test-user',
        channelId: 'test-channel',
        // Add webhook context to bypass authentication
        message: {
          webhookId: 'test-webhook',
          author: { username: 'TestWebhook' }
        }
      });

      expect(result).toEqual({
        content: 'Hello from the AI!',
        metadata: null,
      });
    });

    it('should return fallback model metadata correctly', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Response from fallback model',
            },
          },
        ],
        usage: {
          metadata: {
            fallback_model_used: true,
            is_premium: false,
            zero_balance_diverted: true,
          },
        },
      };

      mockCreateCompletion.mockResolvedValue(mockResponse);

      const result = await getAiResponse('test-personality', 'Hello AI', {
        userId: 'test-user',
        channelId: 'test-channel',
        // Add webhook context to bypass authentication
        message: {
          webhookId: 'test-webhook',
          author: { username: 'TestWebhook' }
        }
      });

      expect(result.metadata).toEqual({
        fallback_model_used: true,
        is_premium: false,
        zero_balance_diverted: true,
      });
    });

    it('should return object with null metadata on error', async () => {
      // Mock handleApiError to return a proper error message
      const { handleApiError } = require('../../src/utils/aiErrorHandler');
      handleApiError.mockResolvedValue('Error occurred ||*(an error has occurred; reference: test123)*||');
      
      mockCreateCompletion.mockRejectedValue(new Error('API Error'));

      const result = await getAiResponse('test-personality', 'Hello AI', {
        userId: 'test-user',
        channelId: 'test-channel',
        // Add webhook context to bypass authentication
        message: {
          webhookId: 'test-webhook',
          author: { username: 'TestWebhook' }
        }
      });

      // Error responses now return an object with content and null metadata
      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('metadata', null);
      expect(result.content).toMatch(/Error occurred.*\|\|\*\(an error has occurred; reference: test123\)\*\|\|$/);
    });

    it('should handle invalid response structure', async () => {
      analyzeErrorAndGenerateMessage.mockResolvedValue('Invalid response error');
      mockCreateCompletion.mockResolvedValue({});

      const result = await getAiResponse('test-personality', 'Hello AI', {
        userId: 'test-user',
        channelId: 'test-channel',
        // Add webhook context to bypass authentication
        message: {
          webhookId: 'test-webhook',
          author: { username: 'TestWebhook' }
        }
      });

      expect(result).toEqual({
        content: 'Invalid response error',
        metadata: null,
      });
    });
  });
});