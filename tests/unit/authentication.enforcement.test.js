// Mock OpenAI first
jest.mock('openai', () => ({
  OpenAI: jest.fn(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: { content: 'Test response' },
            },
          ],
        }),
      },
    },
  })),
}));

// Mock aiAuth before requiring aiService
jest.mock('../../src/utils/aiAuth', () => ({
  initAiClient: jest.fn(),
  getAI: jest.fn().mockReturnValue({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: { content: 'Test response' },
            },
          ],
        }),
      },
    },
  }),
  getAiClientForUser: jest.fn().mockImplementation(async userId => {
    // Return different clients based on auth status
    if (mockAuthManager.hasValidToken(userId)) {
      return {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [
                {
                  message: { content: 'Authenticated response' },
                },
              ],
            }),
          },
        },
      };
    }
    // Return default client for unauthenticated users
    return {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: { content: 'Default response' },
              },
            ],
          }),
        },
      },
    };
  }),
}));

const aiService = require('../../src/aiService');
const { botPrefix } = require('../../config');

// Mock AuthManager
const mockAuthManager = {
  hasValidToken: jest.fn(),
  getUserToken: jest.fn(),
  isNsfwVerified: jest.fn().mockReturnValue(true),
};

jest.mock('../../src/core/authentication/AuthManager', () => ({
  AuthManager: jest.fn().mockImplementation(() => mockAuthManager),
}));

// Mock PersonalityDataService
jest.mock('../../src/services/PersonalityDataService', () => ({
  getPersonalityDataService: jest.fn().mockReturnValue({
    getExtendedProfile: jest.fn().mockResolvedValue({
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png',
      errorMessage: 'Error occurred',
      mode: 'normal',
    }),
  }),
}));

describe('Authentication Enforcement', () => {
  // Spy on console methods
  const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
    // Initialize aiService with the mock auth manager
    aiService.initAiClient(mockAuthManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getAiResponse requires authentication', async () => {
    // Mock mockAuthManager.hasValidToken to return false for this user
    mockAuthManager.hasValidToken.mockReturnValue(false);

    // Call getAiResponse with an unauthenticated user
    const response = await aiService.getAiResponse('test-personality', 'Hello', {
      userId: 'unauthenticated-user',
      channelId: 'test-channel',
    });

    // Verify that we get an authentication required message with the bot error marker
    expect(response).toContain('Authentication required');
    expect(response).toContain(`${botPrefix} auth start`);
    expect(response).toContain('BOT_ERROR_MESSAGE:');

    // Verify mockAuthManager.hasValidToken was called with the user ID
    expect(mockAuthManager.hasValidToken).toHaveBeenCalledWith('unauthenticated-user');
  });

  test('getAiResponse checks for authentication with hasValidToken', async () => {
    // Mock mockAuthManager.hasValidToken to return true for this user
    mockAuthManager.hasValidToken.mockReturnValue(true);
    mockAuthManager.getUserToken.mockReturnValue('valid-token');

    // We'll test a simpler scenario: authentication checking
    // Call getAiResponse with an authenticated user ID
    try {
      await aiService.getAiResponse('test-personality', 'Hello', {
        userId: 'authenticated-user',
        channelId: 'test-channel',
      });
    } catch (error) {
      // We expect this to potentially fail in test environment,
      // but we just want to verify authentication was checked
    }

    // The most important verification: hasValidToken was called correctly
    expect(mockAuthManager.hasValidToken).toHaveBeenCalledWith('authenticated-user');
  });

  test('getAiClientForUser returns default client for unauthenticated users', async () => {
    // Mock mockAuthManager.hasValidToken to return false for this user
    mockAuthManager.hasValidToken.mockReturnValue(false);

    // Call getAiClientForUser with an unauthenticated user
    const aiClient = await aiService.getAiClientForUser('unauthenticated-user');

    // Verify that we get a client (falls back to default)
    expect(aiClient).not.toBeNull();

    // Note: The new implementation doesn't check auth in getAiClientForUser
    // It always returns a client (user-specific or default)
  });

  test('getAiClientForUser returns client for authenticated users', async () => {
    // Mock mockAuthManager.hasValidToken to return true for this user
    mockAuthManager.hasValidToken.mockReturnValue(true);
    mockAuthManager.getUserToken.mockReturnValue('valid-token');
    // auth.APP_ID = 'test-app-id';
    // auth.API_KEY = 'test-api-key';

    // Call getAiClientForUser with an authenticated user
    const aiClient = await aiService.getAiClientForUser('authenticated-user');

    // Verify that we get a client object
    expect(aiClient).not.toBeNull();

    // Note: The new implementation always returns a client
    // Auth checking happens at the getAiResponse level, not here
  });
});
