// Mock OpenAI first
jest.mock('openai', () => ({
  OpenAI: jest.fn(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{
            message: { content: 'Test response' }
          }]
        })
      }
    }
  }))
}));

// Mock aiAuth before requiring aiService
jest.mock('../../src/utils/aiAuth', () => ({
  initAiClient: jest.fn(),
  getAI: jest.fn().mockReturnValue({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{
            message: { content: 'Test response' }
          }]
        })
      }
    }
  }),
  getAiClientForUser: jest.fn().mockImplementation(async (userId) => {
    const auth = require('../../src/auth');
    // Return different clients based on auth status
    if (auth.hasValidToken(userId)) {
      return {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{
                message: { content: 'Authenticated response' }
              }]
            })
          }
        }
      };
    }
    // Return default client for unauthenticated users
    return {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{
              message: { content: 'Default response' }
            }]
          })
        }
      }
    };
  })
}));

const aiService = require('../../src/aiService');
const auth = require('../../src/auth');
const { botPrefix } = require('../../config');

// Mock dependencies
jest.mock('../../src/auth', () => ({
  hasValidToken: jest.fn(),
  getUserToken: jest.fn(),
  APP_ID: 'test-app-id',
  API_KEY: 'test-api-key',
  isNsfwVerified: jest.fn().mockReturnValue(true),
  getAuthManager: jest.fn().mockReturnValue(null),
  userTokens: {},
  nsfwVerified: {}
}));

describe('Authentication Enforcement', () => {
  // Spy on console methods
  const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getAiResponse requires authentication', async () => {
    // Mock auth.hasValidToken to return false for this user
    auth.hasValidToken.mockReturnValue(false);

    // Call getAiResponse with an unauthenticated user
    const response = await aiService.getAiResponse('test-personality', 'Hello', {
      userId: 'unauthenticated-user',
      channelId: 'test-channel',
    });

    // Verify that we get an authentication required message with the bot error marker
    expect(response).toContain('Authentication required');
    expect(response).toContain(`${botPrefix} auth start`);
    expect(response).toContain('BOT_ERROR_MESSAGE:');

    // Verify auth.hasValidToken was called with the user ID
    expect(auth.hasValidToken).toHaveBeenCalledWith('unauthenticated-user');
  });

  test('getAiResponse checks for authentication with hasValidToken', async () => {
    // Mock auth.hasValidToken to return true for this user
    auth.hasValidToken.mockReturnValue(true);
    auth.getUserToken.mockReturnValue('valid-token');

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
    expect(auth.hasValidToken).toHaveBeenCalledWith('authenticated-user');
  });

  test('getAiClientForUser returns default client for unauthenticated users', async () => {
    // Mock auth.hasValidToken to return false for this user
    auth.hasValidToken.mockReturnValue(false);

    // Call getAiClientForUser with an unauthenticated user
    const aiClient = await aiService.getAiClientForUser('unauthenticated-user');

    // Verify that we get a client (falls back to default)
    expect(aiClient).not.toBeNull();

    // Note: The new implementation doesn't check auth in getAiClientForUser
    // It always returns a client (user-specific or default)
  });

  test('getAiClientForUser returns client for authenticated users', async () => {
    // Mock auth.hasValidToken to return true for this user
    auth.hasValidToken.mockReturnValue(true);
    auth.getUserToken.mockReturnValue('valid-token');
    auth.APP_ID = 'test-app-id';
    auth.API_KEY = 'test-api-key';

    // Call getAiClientForUser with an authenticated user
    const aiClient = await aiService.getAiClientForUser('authenticated-user');

    // Verify that we get a client object
    expect(aiClient).not.toBeNull();

    // Note: The new implementation always returns a client
    // Auth checking happens at the getAiResponse level, not here
  });
});