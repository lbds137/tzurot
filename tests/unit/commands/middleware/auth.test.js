/**
 * Tests for the authentication middleware
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));

jest.mock('../../../../src/auth', () => ({
  hasValidToken: jest.fn()
}));

jest.mock('../../../../src/utils/webhookUserTracker', () => ({
  isAuthenticationAllowed: jest.fn(),
  shouldBypassNsfwVerification: jest.fn()
}));

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const logger = require('../../../../src/logger');
const auth = require('../../../../src/auth');
const webhookUserTracker = require('../../../../src/utils/webhookUserTracker');

describe('Auth Middleware', () => {
  let authMiddleware;
  let mockMessage;
  let webhookMessage;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create standard mock message
    mockMessage = helpers.createMockMessage();
    mockMessage.author.send = jest.fn().mockResolvedValue({ id: 'dm-message-123' });
    
    // Create webhook mock message
    webhookMessage = {
      ...helpers.createMockMessage(),
      webhookId: 'webhook-123',
      author: {
        id: 'webhook-user-123',
        tag: 'Webhook User#1234',
        username: 'Webhook User',
        send: jest.fn().mockResolvedValue({ id: 'dm-message-123' })
      }
    };
    
    // Set up default mock behavior
    auth.hasValidToken.mockReturnValue(false);
    webhookUserTracker.isAuthenticationAllowed.mockReturnValue(true);
    webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(false);
    
    // Import module after mock setup
    authMiddleware = require('../../../../src/commands/middleware/auth');
  });
  
  it('should allow authenticated users', async () => {
    // Mock user as authenticated
    auth.hasValidToken.mockReturnValue(true);
    
    const result = await authMiddleware(mockMessage, 'ping', []);
    
    expect(result.authenticated).toBe(true);
    expect(result.error).toBeUndefined();
    expect(auth.hasValidToken).toHaveBeenCalledWith(mockMessage.author.id);
  });
  
  it('should allow auth command for unauthenticated users', async () => {
    // Mock user as unauthenticated
    auth.hasValidToken.mockReturnValue(false);
    
    const result = await authMiddleware(mockMessage, 'auth', ['start']);
    
    expect(result.authenticated).toBe(true);
    expect(result.error).toBeUndefined();
  });
  
  it('should allow help command for unauthenticated users', async () => {
    // Mock user as unauthenticated
    auth.hasValidToken.mockReturnValue(false);
    
    const result = await authMiddleware(mockMessage, 'help', []);
    
    expect(result.authenticated).toBe(true);
    expect(result.error).toBeUndefined();
  });
  
  it('should reject unauthenticated users with DM instructions', async () => {
    // Mock user as unauthenticated
    auth.hasValidToken.mockReturnValue(false);
    
    const result = await authMiddleware(mockMessage, 'ping', []);
    
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('You need to authenticate before using this command');
    expect(mockMessage.author.send).toHaveBeenCalled();
    expect(mockMessage.author.send.mock.calls[0][0]).toContain('Authentication Required');
  });
  
  it('should handle DM failures gracefully', async () => {
    // Mock user as unauthenticated
    auth.hasValidToken.mockReturnValue(false);
    
    // Mock DM failure
    mockMessage.author.send = jest.fn().mockRejectedValue(new Error('Cannot send DMs'));
    
    const result = await authMiddleware(mockMessage, 'ping', []);
    
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Authentication Required');
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.warn.mock.calls[0][0]).toContain('Failed to send DM to user');
  });
  
  it('should block auth commands from unauthorized webhook proxies', async () => {
    // Mock webhook as not allowed for authentication
    webhookUserTracker.isAuthenticationAllowed.mockReturnValue(false);
    
    const result = await authMiddleware(webhookMessage, 'auth', ['start']);
    
    expect(result.authenticated).toBe(false);
    expect(result.bypass).toBe(true);
    expect(result.error).toContain('Authentication with Proxy Systems');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Auth command from proxy webhook denied')
    );
  });
  
  it('should allow commands from webhook proxies with auth bypass', async () => {
    // Mock webhook with auth bypass
    webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(true);
    
    const result = await authMiddleware(webhookMessage, 'ping', []);
    
    expect(result.authenticated).toBe(true);
    expect(result.error).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Auth bypass enabled for webhook command')
    );
  });
  
  it('should not bypass auth for auth commands from webhooks', async () => {
    // Mock webhook with auth bypass but trying to use auth command
    webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(true);
    
    const result = await authMiddleware(webhookMessage, 'auth', ['start']);
    
    // Auth commands don't need auth, so result will be authenticated=true
    // but the shouldBypassNsfwVerification path should not be triggered
    expect(result.authenticated).toBe(true);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Auth bypass enabled for webhook command: auth')
    );
  });
  
  it('should log webhook command processing', async () => {
    await authMiddleware(webhookMessage, 'ping', []);
    
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Processing command from webhook: Webhook User')
    );
  });
});