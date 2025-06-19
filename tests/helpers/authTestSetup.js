/**
 * Auth test setup helper
 *
 * Provides utilities for setting up auth-related mocks in tests
 * to handle the removal of NODE_ENV checks
 */

/**
 * Setup auth mocks for tests
 * @param {Object} options - Configuration options
 * @param {boolean} options.isAuthenticated - Whether user should be authenticated
 * @param {Object} options.mockClient - Mock AI client to return
 * @returns {Object} Mock references for assertions
 */
function setupAuthMocks(options = {}) {
  const { isAuthenticated = true, mockClient = createMockAIClient() } = options;

  // Create auth manager mock
  const mockAuthManager = {
    aiClientFactory: {
      getDefaultClient: jest.fn().mockReturnValue(mockClient),
    },
    getAIClient: jest.fn().mockResolvedValue(mockClient),
    userTokenManager: {
      hasValidToken: jest.fn().mockReturnValue(isAuthenticated),
      getUserToken: jest.fn().mockReturnValue(isAuthenticated ? 'mock-token' : null),
    },
    nsfwVerificationManager: {
      isVerified: jest.fn().mockReturnValue(true),
    },
  };

  // Mock the auth module
  jest.doMock('../../src/auth', () => ({
    getAuthManager: jest.fn().mockReturnValue(mockAuthManager),
    hasValidToken: jest.fn().mockReturnValue(isAuthenticated),
    getUserToken: jest.fn().mockReturnValue(isAuthenticated ? 'mock-token' : null),
    isNsfwVerified: jest.fn().mockReturnValue(true),
    API_KEY: 'mock-api-key',
    APP_ID: 'mock-app-id',
  }));

  // Mock aiAuth to return proper client
  jest.doMock('../../src/utils/aiAuth', () => ({
    initAI: jest.fn(),
    initAiAuth: jest.fn(),
    getAI: jest.fn().mockReturnValue(mockClient),
    getAIForUser: jest.fn().mockResolvedValue(mockClient),
    getAiClientForUser: jest.fn().mockResolvedValue(mockClient),
  }));

  return {
    mockAuthManager,
    mockClient,
  };
}

/**
 * Create a mock AI client for testing
 * @param {Object} options - Configuration options
 * @returns {Object} Mock AI client
 */
function createMockAIClient(options = {}) {
  const {
    responseContent = 'Mock AI response',
    shouldError = false,
    errorMessage = 'Mock API error',
  } = options;

  return {
    _type: 'mock-openai-client',
    chat: {
      completions: {
        create: jest.fn().mockImplementation(async () => {
          if (shouldError) {
            throw new Error(errorMessage);
          }
          return {
            choices: [
              {
                message: {
                  content: responseContent,
                },
              },
            ],
          };
        }),
      },
    },
  };
}

/**
 * Reset auth-related mocks
 */
function resetAuthMocks() {
  jest.unmock('../../src/auth');
  jest.unmock('../../src/utils/aiAuth');
}

module.exports = {
  setupAuthMocks,
  createMockAIClient,
  resetAuthMocks,
};
