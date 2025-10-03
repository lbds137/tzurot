/**
 * Tests for AI Service DDD Authentication Error Handling
 */

const aiService = require('../../src/aiService');
const logger = require('../../src/logger');
const { trackError } = require('../../src/utils/errorTracker');

// Mock dependencies
jest.mock('../../src/logger');
jest.mock('../../src/utils/errorTracker');

// Mock ApplicationBootstrap for DDD authentication
const mockAuthService = {
  getAuthenticationStatus: jest.fn(),
};

const mockPersonalityApplicationService = {
  getPersonality: jest.fn(),
};

jest.mock('../../src/application/bootstrap/ApplicationBootstrap', () => ({
  getApplicationBootstrap: jest.fn(() => ({
    getApplicationServices: jest.fn(() => ({
      authenticationService: mockAuthService,
    })),
    getPersonalityApplicationService: jest.fn(() => mockPersonalityApplicationService),
  })),
}));

// Mock OpenAI
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  })),
}));

// Mock other AI service dependencies

jest.mock('../../src/utils/aiRequestManager', () => ({
  createRequestId: jest.fn(() => 'test-request-id'),
  createBlackoutKey: jest.fn(() => 'test-blackout-key'),
  addToBlackoutList: jest.fn(),
  isInBlackoutPeriod: jest.fn(() => false),
  prepareRequestHeaders: jest.fn(() => ({})),
  pendingRequests: new Map(),
  getPendingRequest: jest.fn(() => null),
  setPendingRequest: jest.fn(),
  deletePendingRequest: jest.fn(),
  storePendingRequest: jest.fn(),
  removePendingRequest: jest.fn(),
}));

jest.mock('../../src/utils/aiMessageFormatter', () => ({
  formatApiMessages: jest.fn((messages) => messages),
}));

jest.mock('../../src/utils/webhookUserTracker', () => ({
  shouldBypassNsfwVerification: jest.fn(() => false),
}));

jest.mock('../../src/utils/aiErrorHandler', () => ({
  isErrorResponse: jest.fn(() => false),
  analyzeErrorAndGenerateMessage: jest.fn(),
  handleApiError: jest.fn(),
}));

jest.mock('../../src/services/PersonalityDataService', () => ({
  getPersonalityDataService: jest.fn(() => ({
    buildPromptContext: jest.fn(() => ({ prompt: 'test prompt' })),
  })),
}));

jest.mock('../../src/application/services/FeatureFlags', () => ({
  createFeatureFlags: jest.fn(() => ({
    isEnabled: jest.fn(() => false),
  })),
}));

describe('AI Service - DDD Authentication Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset logger mocks
    logger.error.mockClear();
    logger.debug.mockClear();
    logger.info.mockClear();
  });

  describe('getAiClientForUser - Authentication Errors', () => {
    it('should handle errors when checking user authentication (covers line 35-36)', async () => {
      // Mock the bootstrap to throw when getting auth service
      const { getApplicationBootstrap } = require('../../src/application/bootstrap/ApplicationBootstrap');
      getApplicationBootstrap.mockImplementationOnce(() => {
        throw new Error('Bootstrap not initialized');
      });

      const { getAiClientForUser } = aiService;
      const result = await getAiClientForUser('test-user-id');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        '[AIService] Error getting AI client for user test-user-id:',
        expect.any(Error)
      );
    });

    it('should handle auth service errors (covers line 69-70)', async () => {
      // Mock the auth service to throw an error
      mockAuthService.getAuthenticationStatus.mockRejectedValue(
        new Error('Database connection failed')
      );

      const { getAiClientForUser } = aiService;
      const result = await getAiClientForUser('test-user-id');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        '[AIService] Error getting AI client for user test-user-id:',
        expect.any(Error)
      );
    });

    it('should handle errors when getting AI client for user', async () => {
      // Mock the auth service to throw an error
      mockAuthService.getAuthenticationStatus.mockRejectedValue(
        new Error('Service unavailable')
      );

      const { getAiClientForUser } = aiService;
      const result = await getAiClientForUser('test-user-id');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        '[AIService] Error getting AI client for user test-user-id:',
        expect.any(Error)
      );
    });

    it('should handle errors when OpenAI client creation fails', async () => {
      // Mock successful auth but OpenAI throws
      mockAuthService.getAuthenticationStatus.mockResolvedValue({
        isAuthenticated: true,
        user: {
          token: { value: 'test-token' }
        }
      });

      // Mock OpenAI to throw
      const { OpenAI } = require('openai');
      OpenAI.mockImplementationOnce(() => {
        throw new Error('Invalid API key format');
      });

      const { getAiClientForUser } = aiService;
      const result = await getAiClientForUser('test-user-id');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        '[AIService] Error getting AI client for user test-user-id:',
        expect.any(Error)
      );
    });

    it('should log debug message when no userId provided', async () => {
      const { getAiClientForUser } = aiService;
      const result = await getAiClientForUser(null);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        '[AIService] No userId provided, using default client'
      );
    });
  });


  describe('Internal auth check function coverage', () => {
    it('should cover the error path in isUserAuthenticated (lines 35-36)', async () => {
      // This tests the internal function through getAiResponse flow
      // Mock bootstrap to throw error
      const { getApplicationBootstrap } = require('../../src/application/bootstrap/ApplicationBootstrap');
      
      // First call succeeds (for personality lookup)
      getApplicationBootstrap.mockImplementationOnce(() => ({
        getPersonalityApplicationService: jest.fn(() => mockPersonalityApplicationService),
      }));
      
      // Second call fails (for auth check) 
      getApplicationBootstrap.mockImplementationOnce(() => {
        throw new Error('Bootstrap error');
      });

      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        profile: { model: 'gpt-4' }
      });

      const { getAiResponse } = aiService;
      const result = await getAiResponse('test-personality', 'Hello', {
        userId: 'test-user',
        channelId: 'test-channel',
      });

      // Should still work but log the auth error
      expect(logger.error).toHaveBeenCalledWith(
        '[AIService] Error checking user authentication:',
        expect.any(Error)
      );
    });
  });
});