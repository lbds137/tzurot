// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../src/auth', () => ({
  getAuthorizationUrl: jest.fn().mockReturnValue('https://example.com/authorize'),
  exchangeCodeForToken: jest.fn().mockResolvedValue('mock-token'),
  storeUserToken: jest.fn().mockResolvedValue(true),
  getUserToken: jest.fn().mockReturnValue('mock-token'),
  hasValidToken: jest.fn().mockReturnValue(true),
  deleteUserToken: jest.fn().mockResolvedValue(true),
  initAuth: jest.fn().mockResolvedValue(),
  APP_ID: 'mock-app-id',
  API_KEY: 'mock-api-key'
}));
jest.mock('../../../../src/utils/webhookUserTracker', () => ({
  isProxySystemWebhook: jest.fn().mockReturnValue(false)
}));
jest.mock('../../../../src/commands/utils/commandValidator');

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const auth = require('../../../../src/auth');
const webhookUserTracker = require('../../../../src/utils/webhookUserTracker');
const validator = require('../../../../src/commands/utils/commandValidator');

describe('Auth Command', () => {
  let authCommand;
  let mockMessage;
  let mockDMMessage;
  let mockWebhookMessage;
  let mockDirectSend;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset modules
    jest.resetModules();
    
    // Create mock messages
    mockMessage = helpers.createMockMessage(); // Regular channel message
    mockDMMessage = helpers.createMockMessage({ isDM: true }); // DM message
    mockWebhookMessage = helpers.createMockMessage(); // Message with webhook
    mockWebhookMessage.webhookId = 'mock-webhook-id';
    
    // Mock user send
    mockMessage.author.send = jest.fn().mockResolvedValue({ id: 'dm-message-123' });
    mockDMMessage.author.send = jest.fn().mockResolvedValue({ id: 'dm-message-123' });
    mockWebhookMessage.author.send = jest.fn().mockResolvedValue({ id: 'dm-message-123' });
    
    // Mock direct send function
    mockDirectSend = jest.fn().mockResolvedValue({
      id: 'direct-sent-123'
    });
    
    // Mock validator
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
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
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: 'I\'ve sent you a DM with authentication instructions'
      });
    });
    
    it('should fall back to channel message if DM fails', async () => {
      mockMessage.author.send.mockRejectedValueOnce(new Error('Cannot send DM'));
      
      await authCommand.execute(mockMessage, ['start']);
      
      expect(auth.getAuthorizationUrl).toHaveBeenCalled();
      expect(mockMessage.author.send).toHaveBeenCalled();
      helpers.verifyErrorResponse(mockDirectSend, {
        contains: 'Unable to send you a DM'
      });
    });
  });
  
  describe('auth code subcommand', () => {
    it('should reject auth code submission in public channels', async () => {
      await authCommand.execute(mockMessage, ['code', 'mock-code']);
      
      expect(mockMessage.delete).toHaveBeenCalled();
      helpers.verifyErrorResponse(mockDirectSend, {
        contains: 'For security, please submit your authorization code via DM'
      });
      expect(auth.exchangeCodeForToken).not.toHaveBeenCalled();
    });
    
    it('should process auth code when submitted via DM', async () => {
      await authCommand.execute(mockDMMessage, ['code', 'mock-code']);
      
      expect(mockDMMessage.delete).not.toHaveBeenCalled(); // Should not try to delete DM
      expect(auth.exchangeCodeForToken).toHaveBeenCalledWith('mock-code');
      expect(auth.storeUserToken).toHaveBeenCalledWith(mockDMMessage.author.id, 'mock-token');
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: 'Authorization successful!'
      });
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
      helpers.verifyErrorResponse(mockDirectSend, {
        contains: 'Authorization failed'
      });
    });
  });
  
  describe('auth status subcommand', () => {
    it('should show authorized status for users with token', async () => {
      auth.hasValidToken.mockReturnValueOnce(true);
      
      await authCommand.execute(mockMessage, ['status']);
      
      expect(auth.hasValidToken).toHaveBeenCalledWith(mockMessage.author.id);
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: 'You have a valid authorization token'
      });
    });
    
    it('should show unauthorized status for users without token', async () => {
      auth.hasValidToken.mockReturnValueOnce(false);
      
      await authCommand.execute(mockMessage, ['status']);
      
      expect(auth.hasValidToken).toHaveBeenCalledWith(mockMessage.author.id);
      helpers.verifyErrorResponse(mockDirectSend, {
        contains: 'You don\'t have an authorization token'
      });
    });
  });
  
  describe('auth revoke subcommand', () => {
    it('should revoke user authorization', async () => {
      await authCommand.execute(mockMessage, ['revoke']);
      
      expect(auth.deleteUserToken).toHaveBeenCalledWith(mockMessage.author.id);
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: 'Your authorization has been revoked'
      });
    });
    
    it('should handle failed revocation', async () => {
      auth.deleteUserToken.mockResolvedValueOnce(false);
      
      await authCommand.execute(mockMessage, ['revoke']);
      
      expect(auth.deleteUserToken).toHaveBeenCalledWith(mockMessage.author.id);
      helpers.verifyErrorResponse(mockDirectSend, {
        contains: 'Failed to revoke authorization'
      });
    });
  });
  
  describe('general auth command behavior', () => {
    it('should show help when no subcommand is provided', async () => {
      await authCommand.execute(mockMessage, []);
      
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: 'Authentication Commands'
      });
    });
    
    it('should handle unknown subcommands', async () => {
      await authCommand.execute(mockMessage, ['invalid']);
      
      helpers.verifyErrorResponse(mockDirectSend, {
        contains: 'Unknown auth subcommand'
      });
    });

    it('should handle webhook proxy systems', async () => {
      webhookUserTracker.isProxySystemWebhook.mockReturnValueOnce(true);
      
      await authCommand.execute(mockWebhookMessage, ['start']);
      
      expect(webhookUserTracker.isProxySystemWebhook).toHaveBeenCalledWith(mockWebhookMessage);
      helpers.verifySuccessResponse(mockDirectSend, {
        contains: 'Authentication with Proxy Systems'
      });
    });
  });
});