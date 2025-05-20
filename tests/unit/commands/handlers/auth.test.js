/**
 * Tests for the auth command handler
 * Consolidates tests from multiple files into standardized format
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));

// Create the auth mock
jest.mock('../../../../src/auth', () => ({
  getAuthorizationUrl: jest.fn(),
  exchangeCodeForToken: jest.fn(),
  storeUserToken: jest.fn(),
  getUserToken: jest.fn(),
  hasValidToken: jest.fn(),
  isNsfwVerified: jest.fn(),
  deleteUserToken: jest.fn(),
  initAuth: jest.fn(),
  APP_ID: 'mock-app-id',
  API_KEY: 'mock-api-key'
}));

jest.mock('../../../../src/utils/webhookUserTracker', () => ({
  isProxySystemWebhook: jest.fn()
}));

// Mock command validator
jest.mock('../../../../src/commands/utils/commandValidator', () => ({
  createDirectSend: jest.fn().mockImplementation((message) => {
    return async (content) => {
      return message.channel.send(content);
    };
  }),
  isAdmin: jest.fn().mockReturnValue(false),
  canManageMessages: jest.fn().mockReturnValue(false),
  isNsfwChannel: jest.fn().mockReturnValue(false)
}));

// Import the test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mock dependencies
const auth = require('../../../../src/auth');
const logger = require('../../../../src/logger');
const webhookUserTracker = require('../../../../src/utils/webhookUserTracker');
const validator = require('../../../../src/commands/utils/commandValidator');

describe('Auth Command', () => {
  let authCommand;
  let mockMessage;
  let mockDMMessage;
  let mockWebhookMessage;
  
  beforeEach(() => {
    // Reset modules between tests
    jest.clearAllMocks();
    
    // Mock logger methods
    logger.error = jest.fn();
    logger.info = jest.fn();
    logger.debug = jest.fn();
    
    // Create mock messages
    mockMessage = helpers.createMockMessage(); // Regular channel message
    mockDMMessage = helpers.createMockMessage({ isDM: true }); // DM message
    mockWebhookMessage = helpers.createMockMessage(); // Message with webhook
    mockWebhookMessage.webhookId = 'mock-webhook-id';
    
    // Setup author.send mock
    mockMessage.author.send = jest.fn().mockResolvedValue({ id: 'dm-message-123' });
    mockDMMessage.author.send = jest.fn().mockResolvedValue({ id: 'dm-message-123' });
    mockWebhookMessage.author.send = jest.fn().mockResolvedValue({ id: 'dm-message-123' });
    
    // Setup channel.send mock
    mockMessage.channel.send = jest.fn().mockResolvedValue({ id: 'sent-message-123' });
    mockDMMessage.channel.send = jest.fn().mockResolvedValue({ id: 'sent-message-123' });
    mockWebhookMessage.channel.send = jest.fn().mockResolvedValue({ id: 'sent-message-123' });
    
    // Setup channel.sendTyping mock
    mockMessage.channel.sendTyping = jest.fn().mockResolvedValue(undefined);
    mockDMMessage.channel.sendTyping = jest.fn().mockResolvedValue(undefined);
    mockWebhookMessage.channel.sendTyping = jest.fn().mockResolvedValue(undefined);
    
    // Set up auth mocks with default values
    auth.getAuthorizationUrl.mockResolvedValue('https://example.com/authorize');
    auth.exchangeCodeForToken.mockResolvedValue('mock-token');
    auth.storeUserToken.mockResolvedValue(true);
    auth.hasValidToken.mockReturnValue(false);
    auth.deleteUserToken.mockResolvedValue(true);
    
    // Set up proxy webhook detection
    webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
    
    // Import the command after setting up mocks
    authCommand = require('../../../../src/commands/handlers/auth');
  });
  
  it('should have the correct metadata', () => {
    expect(authCommand.meta).toEqual({
      name: 'auth',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  describe('auth start subcommand', () => {
    it('should send authorization URL via DM when possible', async () => {
      await authCommand.execute(mockMessage, ['start']);
      
      expect(auth.getAuthorizationUrl).toHaveBeenCalled();
      expect(mockMessage.author.send).toHaveBeenCalled();
      expect(mockMessage.channel.send).toHaveBeenCalled();
      expect(mockMessage.channel.send.mock.calls[0][0]).toContain('I\'ve sent you a DM');
    });
    
    it('should send auth URL directly in DM channels', async () => {
      await authCommand.execute(mockDMMessage, ['start']);
      
      expect(auth.getAuthorizationUrl).toHaveBeenCalled();
      expect(mockDMMessage.channel.send).toHaveBeenCalled();
      expect(mockDMMessage.channel.send.mock.calls[0][0]).toContain('https://example.com/authorize');
    });
    
    it('should fall back to channel message if DM fails', async () => {
      mockMessage.author.send.mockRejectedValueOnce(new Error('Cannot send DM'));
      
      await authCommand.execute(mockMessage, ['start']);
      
      expect(auth.getAuthorizationUrl).toHaveBeenCalled();
      expect(mockMessage.author.send).toHaveBeenCalled();
      expect(mockMessage.channel.send).toHaveBeenCalled();
      expect(mockMessage.channel.send.mock.calls[0][0]).toContain('Unable to send you a DM');
    });
    
    it('should handle auth URL generation errors', async () => {
      auth.getAuthorizationUrl.mockResolvedValueOnce(null);
      
      await authCommand.execute(mockMessage, ['start']);
      
      expect(mockMessage.channel.send).toHaveBeenCalled();
      expect(mockMessage.channel.send.mock.calls[0][0]).toContain('Failed to generate authentication URL');
    });
  });
  
  describe('auth code subcommand', () => {
    it('should show usage if no code is provided', async () => {
      await authCommand.execute(mockMessage, ['code']);
      
      expect(mockMessage.channel.send).toHaveBeenCalled();
      expect(mockMessage.channel.send.mock.calls[0][0]).toContain('Please provide your authorization code');
    });
    
    it('should reject auth code submission in public channels', async () => {
      await authCommand.execute(mockMessage, ['code', 'mock-code']);
      
      expect(mockMessage.delete).toHaveBeenCalled();
      expect(mockMessage.channel.send).toHaveBeenCalled();
      expect(mockMessage.channel.send.mock.calls[0][0]).toContain('For security');
      expect(auth.exchangeCodeForToken).not.toHaveBeenCalled();
    });
    
    it('should process auth code when submitted via DM', async () => {
      await authCommand.execute(mockDMMessage, ['code', 'mock-code']);
      
      expect(mockDMMessage.delete).not.toHaveBeenCalled(); // Should not try to delete DM
      expect(auth.exchangeCodeForToken).toHaveBeenCalledWith('mock-code');
      expect(auth.storeUserToken).toHaveBeenCalledWith(mockDMMessage.author.id, 'mock-token');
      expect(mockDMMessage.channel.send).toHaveBeenCalled();
      expect(mockDMMessage.channel.send.mock.calls[0][0]).toContain('Authorization successful');
    });
    
    it('should handle spoiler-tagged codes properly', async () => {
      await authCommand.execute(mockDMMessage, ['code', '||mock-code||']);
      
      expect(auth.exchangeCodeForToken).toHaveBeenCalledWith('mock-code'); // Spoiler tags removed
      expect(auth.storeUserToken).toHaveBeenCalledWith(mockDMMessage.author.id, 'mock-token');
    });
    
    it('should handle failed code exchange', async () => {
      auth.exchangeCodeForToken.mockResolvedValueOnce(null);
      
      await authCommand.execute(mockDMMessage, ['code', 'invalid-code']);
      
      expect(auth.exchangeCodeForToken).toHaveBeenCalledWith('invalid-code');
      expect(auth.storeUserToken).not.toHaveBeenCalled();
      expect(mockDMMessage.channel.send).toHaveBeenCalled();
      expect(mockDMMessage.channel.send.mock.calls[0][0]).toContain('Authorization failed');
    });
    
    it('should handle token storage errors', async () => {
      auth.storeUserToken.mockResolvedValueOnce(false);
      
      await authCommand.execute(mockDMMessage, ['code', 'mock-code']);
      
      expect(mockDMMessage.channel.send).toHaveBeenCalled();
      expect(mockDMMessage.channel.send.mock.calls[0][0]).toContain('Failed to store authorization token');
    });
  });
  
  describe('auth status subcommand', () => {
    it('should show authorized status for users with token', async () => {
      auth.hasValidToken.mockReturnValueOnce(true);
      
      await authCommand.execute(mockMessage, ['status']);
      
      expect(auth.hasValidToken).toHaveBeenCalledWith(mockMessage.author.id);
      expect(mockMessage.channel.send).toHaveBeenCalled();
      expect(mockMessage.channel.send.mock.calls[0][0]).toContain('have a valid authorization token');
    });
    
    it('should show unauthorized status for users without token', async () => {
      auth.hasValidToken.mockReturnValueOnce(false);
      
      await authCommand.execute(mockMessage, ['status']);
      
      expect(auth.hasValidToken).toHaveBeenCalledWith(mockMessage.author.id);
      expect(mockMessage.channel.send).toHaveBeenCalled();
      expect(mockMessage.channel.send.mock.calls[0][0]).toContain('don\'t have an authorization token');
    });
  });
  
  describe('auth revoke subcommand', () => {
    it('should revoke user authorization', async () => {
      await authCommand.execute(mockMessage, ['revoke']);
      
      expect(auth.deleteUserToken).toHaveBeenCalledWith(mockMessage.author.id);
      expect(mockMessage.channel.send).toHaveBeenCalled();
      expect(mockMessage.channel.send.mock.calls[0][0]).toContain('Your authorization has been revoked');
    });
    
    it('should handle failed revocation', async () => {
      auth.deleteUserToken.mockResolvedValueOnce(false);
      
      await authCommand.execute(mockMessage, ['revoke']);
      
      expect(auth.deleteUserToken).toHaveBeenCalledWith(mockMessage.author.id);
      expect(mockMessage.channel.send).toHaveBeenCalled();
      expect(mockMessage.channel.send.mock.calls[0][0]).toContain('Failed to revoke authorization');
    });
  });
  
  describe('general auth command behavior', () => {
    it('should show help when no subcommand is provided', async () => {
      await authCommand.execute(mockMessage, []);
      
      expect(mockMessage.channel.send).toHaveBeenCalled();
      expect(mockMessage.channel.send.mock.calls[0][0]).toContain('Authentication Commands');
    });
    
    it('should handle unknown subcommands', async () => {
      await authCommand.execute(mockMessage, ['invalid']);
      
      expect(mockMessage.channel.send).toHaveBeenCalled();
      expect(mockMessage.channel.send.mock.calls[0][0]).toContain('Unknown auth subcommand');
    });

    it('should handle webhook proxy systems', async () => {
      webhookUserTracker.isProxySystemWebhook.mockReturnValueOnce(true);
      
      await authCommand.execute(mockWebhookMessage, ['start']);
      
      expect(webhookUserTracker.isProxySystemWebhook).toHaveBeenCalledWith(mockWebhookMessage);
      expect(mockWebhookMessage.channel.send).toHaveBeenCalled();
      expect(mockWebhookMessage.channel.send.mock.calls[0][0]).toContain('Authentication with Proxy Systems');
    });
  });
});