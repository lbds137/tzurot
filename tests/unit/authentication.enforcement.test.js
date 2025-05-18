const aiService = require('../../src/aiService');
const auth = require('../../src/auth');

// Mock dependencies
jest.mock('../../src/auth');

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
    expect(response).toContain('!tz auth');
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

  test('getAiClientForUser returns null for unauthenticated users', () => {
    // Mock auth.hasValidToken to return false for this user
    auth.hasValidToken.mockReturnValue(false);

    // Call getAiClientForUser with an unauthenticated user
    const aiClient = aiService.getAiClientForUser('unauthenticated-user');

    // Verify that we get null
    expect(aiClient).toBeNull();

    // Verify auth.hasValidToken was called with the user ID
    expect(auth.hasValidToken).toHaveBeenCalledWith('unauthenticated-user');
  });

  test('getAiClientForUser returns client for authenticated users', () => {
    // Mock auth.hasValidToken to return true for this user
    auth.hasValidToken.mockReturnValue(true);
    auth.getUserToken.mockReturnValue('valid-token');
    auth.APP_ID = 'test-app-id';
    auth.API_KEY = 'test-api-key';

    // Call getAiClientForUser with an authenticated user
    const aiClient = aiService.getAiClientForUser('authenticated-user');

    // Verify that we get a client object
    expect(aiClient).not.toBeNull();

    // Verify auth.hasValidToken was called with the user ID
    expect(auth.hasValidToken).toHaveBeenCalledWith('authenticated-user');
    expect(auth.getUserToken).toHaveBeenCalledWith('authenticated-user');
  });
});