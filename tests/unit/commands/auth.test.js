/**
 * Tests for the auth command handler
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../src/logger');
jest.mock('../../../config', () => ({
  botPrefix: '!tz'
}));

jest.mock('../../../src/auth', () => ({
  getAuthorizationUrl: jest.fn(),
  exchangeCodeForToken: jest.fn(),
  storeUserToken: jest.fn(),
  hasValidToken: jest.fn(),
  isNsfwVerified: jest.fn(),
  deleteUserToken: jest.fn()
}));

jest.mock('../../../src/utils/webhookUserTracker', () => ({
  isProxySystemWebhook: jest.fn()
}));

// Mock utils and commandValidator
jest.mock('../../../src/utils', () => ({
  createDirectSend: jest.fn().mockImplementation((message) => {
    return async (content) => {
      return message.channel.send(content);
    };
  })
}));

jest.mock('../../../src/commands/utils/commandValidator', () => {
  return {
    createDirectSend: jest.fn().mockImplementation((message) => {
      const directSend = async (content) => {
        return message.channel.send(content);
      };
      return directSend;
    }),
    isAdmin: jest.fn().mockReturnValue(false),
    canManageMessages: jest.fn().mockReturnValue(false),
    isNsfwChannel: jest.fn().mockReturnValue(false)
  };
});

// Import test helpers
const helpers = require('../../utils/commandTestHelpers');

// Import mocked modules
const logger = require('../../../src/logger');
const validator = require('../../../src/commands/utils/commandValidator');
const auth = require('../../../src/auth');
const webhookUserTracker = require('../../../src/utils/webhookUserTracker');

describe('Auth Command', () => {
  let authCommand;
  let mockMessage;
  let dmMockMessage;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock message with standard channel.send mock
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      content: 'Auth response'
    });
    
    // Create DM mock message
    dmMockMessage = helpers.createMockMessage({ isDM: true });
    dmMockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'dm-message-123',
      content: 'Auth DM response'
    });
    
    // Mock sendTyping
    mockMessage.channel.sendTyping = jest.fn().mockResolvedValue(undefined);
    dmMockMessage.channel.sendTyping = jest.fn().mockResolvedValue(undefined);
    
    // Mock DM sending
    mockMessage.author.send = jest.fn().mockResolvedValue({
      id: 'dm-message-123',
      content: 'DM content'
    });
    
    // Mock message delete
    mockMessage.delete = jest.fn().mockResolvedValue(undefined);
    dmMockMessage.delete = jest.fn().mockResolvedValue(undefined);
    
    // Set up auth mocks with default values
    auth.getAuthorizationUrl.mockResolvedValue('https://example.com/auth');
    auth.exchangeCodeForToken.mockResolvedValue('mock-token');
    auth.storeUserToken.mockResolvedValue(true);
    auth.hasValidToken.mockReturnValue(false);
    auth.deleteUserToken.mockResolvedValue(true);
    
    // Set up proxy webhook detection
    webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
    
    // Import command module after mock setup
    authCommand = require('../../../src/commands/handlers/auth');
  });
  
  it('should show usage information when no subcommand is provided', async () => {
    const result = await authCommand.execute(mockMessage, []);
    
    // Verify that createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify usage information was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Authentication Commands')
    );
  });
  
  describe('Start Subcommand', () => {
    it('should send auth URL in DMs', async () => {
      const result = await authCommand.execute(dmMockMessage, ['start']);
      
      // Verify auth URL was generated
      expect(auth.getAuthorizationUrl).toHaveBeenCalled();
      
      // Verify auth URL was sent in the DM channel
      expect(dmMockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('https://example.com/auth')
      );
    });
    
    it('should send auth URL via DM in public channels', async () => {
      const result = await authCommand.execute(mockMessage, ['start']);
      
      // Verify auth URL was generated
      expect(auth.getAuthorizationUrl).toHaveBeenCalled();
      
      // Verify a DM was sent
      expect(mockMessage.author.send).toHaveBeenCalledWith(
        expect.stringContaining('https://example.com/auth')
      );
      
      // Verify notification was sent in the channel
      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('I\'ve sent you a DM')
      );
    });
    
    it('should handle DM sending errors', async () => {
      // Mock DM error
      mockMessage.author.send = jest.fn().mockRejectedValue(new Error('Cannot send DMs'));
      
      const result = await authCommand.execute(mockMessage, ['start']);
      
      // Verify error message was sent in the channel
      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('Unable to send you a DM')
      );
    });
    
    it('should handle auth URL generation errors', async () => {
      // Mock auth URL error
      auth.getAuthorizationUrl.mockResolvedValueOnce(null);
      
      const result = await authCommand.execute(mockMessage, ['start']);
      
      // Verify error message was sent
      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('Failed to generate authentication URL')
      );
    });
  });
  
  describe('Code Subcommand', () => {
    it('should show usage if no code is provided', async () => {
      const result = await authCommand.execute(mockMessage, ['code']);
      
      // Verify usage message was sent
      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('Please provide your authorization code')
      );
    });
    
    it('should reject codes in public channels for security', async () => {
      const result = await authCommand.execute(mockMessage, ['code', 'test-code']);
      
      // Verify message deletion was attempted
      expect(mockMessage.delete).toHaveBeenCalled();
      
      // Verify security warning was sent
      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('For security, please submit your authorization code via DM')
      );
    });
    
    it('should accept codes in DM channels', async () => {
      const result = await authCommand.execute(dmMockMessage, ['code', 'test-code']);
      
      // Verify code exchange was attempted
      expect(auth.exchangeCodeForToken).toHaveBeenCalledWith('test-code');
      
      // Verify token was stored
      expect(auth.storeUserToken).toHaveBeenCalledWith(dmMockMessage.author.id, 'mock-token');
      
      // Verify success message was sent
      expect(dmMockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('Authorization successful')
      );
    });
    
    it('should handle spoiler-wrapped codes', async () => {
      const result = await authCommand.execute(dmMockMessage, ['code', '||test-code||']);
      
      // Verify code was extracted from spoiler tags
      expect(auth.exchangeCodeForToken).toHaveBeenCalledWith('test-code');
    });
    
    it('should handle token exchange errors', async () => {
      // Mock token exchange error
      auth.exchangeCodeForToken.mockResolvedValueOnce(null);
      
      const result = await authCommand.execute(dmMockMessage, ['code', 'test-code']);
      
      // Verify error message was sent
      expect(dmMockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('Authorization failed')
      );
    });
    
    it('should handle token storage errors', async () => {
      // Mock token storage error
      auth.storeUserToken.mockResolvedValueOnce(false);
      
      const result = await authCommand.execute(dmMockMessage, ['code', 'test-code']);
      
      // Verify error message was sent
      expect(dmMockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('Failed to store authorization token')
      );
    });
  });
  
  describe('Status Subcommand', () => {
    it('should show unauthorized status correctly', async () => {
      // Mock unauthorized status
      auth.hasValidToken.mockReturnValueOnce(false);
      
      const result = await authCommand.execute(mockMessage, ['status']);
      
      // Verify status check was called
      expect(auth.hasValidToken).toHaveBeenCalledWith(mockMessage.author.id);
      
      // Verify unauthorized message was sent
      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('You don\'t have an authorization token')
      );
    });
    
    it('should show authorized status correctly', async () => {
      // Mock authorized status
      auth.hasValidToken.mockReturnValueOnce(true);
      
      const result = await authCommand.execute(mockMessage, ['status']);
      
      // Verify status check was called
      expect(auth.hasValidToken).toHaveBeenCalledWith(mockMessage.author.id);
      
      // Verify authorized message was sent
      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('You have a valid authorization token')
      );
    });
  });
  
  describe('Revoke Subcommand', () => {
    it('should revoke authentication successfully', async () => {
      const result = await authCommand.execute(mockMessage, ['revoke']);
      
      // Verify token deletion was attempted
      expect(auth.deleteUserToken).toHaveBeenCalledWith(mockMessage.author.id);
      
      // Verify success message was sent
      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('Your authorization has been revoked')
      );
    });
    
    it('should handle revoke errors', async () => {
      // Mock delete error
      auth.deleteUserToken.mockResolvedValueOnce(false);
      
      const result = await authCommand.execute(mockMessage, ['revoke']);
      
      // Verify error message was sent
      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('Failed to revoke authorization')
      );
    });
  });
  
  it('should handle unknown subcommands', async () => {
    const result = await authCommand.execute(mockMessage, ['unknown']);
    
    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Unknown auth subcommand: `unknown`')
    );
  });
  
  it('should handle proxy system webhooks', async () => {
    // Mock webhook message
    const webhookMessage = helpers.createMockMessage();
    webhookMessage.webhookId = 'webhook-123';
    webhookMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      content: 'Webhook response'
    });
    
    // Mock proxy system detection
    webhookUserTracker.isProxySystemWebhook.mockReturnValueOnce(true);
    
    const result = await authCommand.execute(webhookMessage, ['start']);
    
    // Verify proxy system detection was checked
    expect(webhookUserTracker.isProxySystemWebhook).toHaveBeenCalledWith(webhookMessage);
    
    // Verify proxy system message was sent
    expect(webhookMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Authentication with Proxy Systems')
    );
  });
  
  it('should expose correct metadata', () => {
    expect(authCommand.meta).toBeDefined();
    expect(authCommand.meta.name).toBe('auth');
    expect(authCommand.meta.description).toBeTruthy();
  });
});