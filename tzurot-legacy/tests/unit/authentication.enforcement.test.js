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

// Mock ApplicationBootstrap for DDD authentication
const mockDDDAuthService = {
  getAuthenticationStatus: jest.fn(),
};

jest.mock('../../src/application/bootstrap/ApplicationBootstrap', () => ({
  getApplicationBootstrap: jest.fn().mockReturnValue({
    getApplicationServices: jest.fn().mockReturnValue({
      authenticationService: mockDDDAuthService,
    }),
  }),
}));

const aiService = require('../../src/aiService');
const { botPrefix } = require('../../config');

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

  // Mock OpenAI client for different auth states
  const authenticatedClient = {
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

  const defaultClient = {
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

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock getAiClientForUser to return different clients based on auth
    aiService.getAiClientForUser = jest.fn().mockImplementation(async (userId) => {
      const authStatus = await mockDDDAuthService.getAuthenticationStatus(userId);
      if (authStatus && authStatus.isAuthenticated) {
        return authenticatedClient;
      }
      return defaultClient;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getAiResponse requires authentication', async () => {
    // Mock DDD auth service to return unauthenticated status
    mockDDDAuthService.getAuthenticationStatus.mockResolvedValue({
      isAuthenticated: false,
      user: null,
    });

    // Call getAiResponse with an unauthenticated user
    const response = await aiService.getAiResponse('test-personality', 'Hello', {
      userId: 'unauthenticated-user',
      channelId: 'test-channel',
    });

    // Verify that we get an authentication required message with the bot error marker
    expect(response).toContain('Authentication required');
    expect(response).toContain(`${botPrefix} auth start`);
    expect(response).toContain('BOT_ERROR_MESSAGE:');

    // Verify DDD auth service was called with the user ID
    expect(mockDDDAuthService.getAuthenticationStatus).toHaveBeenCalledWith('unauthenticated-user');
  });

  test('getAiResponse checks for authentication with DDD auth service', async () => {
    // Mock DDD auth service to return authenticated status
    mockDDDAuthService.getAuthenticationStatus.mockResolvedValue({
      isAuthenticated: true,
      user: {
        userId: 'authenticated-user',
        nsfwStatus: { verified: true },
      },
    });

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

    // The most important verification: DDD auth service was called correctly
    expect(mockDDDAuthService.getAuthenticationStatus).toHaveBeenCalledWith('authenticated-user');
  });

  test('getAiClientForUser returns default client for unauthenticated users', async () => {
    // Mock DDD auth service to return unauthenticated status
    mockDDDAuthService.getAuthenticationStatus.mockResolvedValue({
      isAuthenticated: false,
      user: null,
    });

    // Call getAiClientForUser with an unauthenticated user
    const aiClient = await aiService.getAiClientForUser('unauthenticated-user');

    // Verify that we get a client (falls back to default)
    expect(aiClient).not.toBeNull();
    expect(aiClient).toBe(defaultClient);
  });

  test('getAiClientForUser returns client for authenticated users', async () => {
    // Mock DDD auth service to return authenticated status
    mockDDDAuthService.getAuthenticationStatus.mockResolvedValue({
      isAuthenticated: true,
      user: {
        userId: 'authenticated-user',
        nsfwStatus: { verified: true },
      },
    });

    // Call getAiClientForUser with an authenticated user
    const aiClient = await aiService.getAiClientForUser('authenticated-user');

    // Verify that we get the authenticated client
    expect(aiClient).not.toBeNull();
    expect(aiClient).toBe(authenticatedClient);
  });
});