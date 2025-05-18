// Mock dependencies
jest.mock('../../src/auth', () => ({
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

// Import the auth module to access mocks
const auth = require('../../src/auth');

// Import the module with the commands
const { handleAuthCommand } = require('../../src/commands');

// Mock Discord.js classes
const mockUser = {
  id: '123456789',
  tag: 'TestUser#1234',
  send: jest.fn().mockResolvedValue(true)
};

const mockChannel = {
  isDMBased: jest.fn(),
  send: jest.fn().mockImplementation(content => Promise.resolve({ content })),
  sendTyping: jest.fn().mockResolvedValue(true)
};

const mockDMChannel = {
  ...mockChannel,
  isDMBased: jest.fn().mockReturnValue(true)
};

const mockPublicChannel = {
  ...mockChannel,
  isDMBased: jest.fn().mockReturnValue(false)
};

const createMockMessage = (inDM = false) => ({
  author: mockUser,
  channel: inDM ? mockDMChannel : mockPublicChannel,
  content: '!tz auth code mock-code',
  id: 'mock-message-id',
  delete: jest.fn().mockResolvedValue(true),
  reply: jest.fn().mockImplementation(content => Promise.resolve({ content }))
});

// Setup and teardown
beforeEach(() => {
  jest.clearAllMocks();
});

describe('Auth Commands', () => {
  describe('auth start command', () => {
    it('should send authorization URL via DM when possible', async () => {
      const message = createMockMessage();
      await handleAuthCommand(message, ['start']);
      
      expect(auth.getAuthorizationUrl).toHaveBeenCalled();
      expect(mockUser.send).toHaveBeenCalled();
      expect(message.channel.send).toHaveBeenCalledWith(
        expect.stringMatching(/I've sent you a DM with authorization instructions/)
      );
    });
    
    it('should fall back to channel message if DM fails', async () => {
      const message = createMockMessage();
      mockUser.send.mockRejectedValueOnce(new Error('Cannot send DM'));
      
      await handleAuthCommand(message, ['start']);
      
      expect(auth.getAuthorizationUrl).toHaveBeenCalled();
      expect(mockUser.send).toHaveBeenCalled();
      expect(message.channel.send).toHaveBeenCalledWith(
        expect.stringMatching(/AI Service Authorization/)
      );
    });
  });
  
  describe('auth code command', () => {
    it('should reject auth code submission in public channels', async () => {
      const message = createMockMessage(false);
      await handleAuthCommand(message, ['code', 'mock-code']);
      
      expect(message.delete).toHaveBeenCalled();
      expect(mockUser.send).toHaveBeenCalledWith(
        expect.stringMatching(/Security Alert/)
      );
      expect(message.channel.send).toHaveBeenCalledWith(
        expect.stringMatching(/For security, authorization codes can only be submitted via DM/)
      );
      expect(auth.exchangeCodeForToken).not.toHaveBeenCalled();
    });
    
    it('should process auth code when submitted via DM', async () => {
      const message = createMockMessage(true);
      await handleAuthCommand(message, ['code', 'mock-code']);
      
      expect(message.delete).not.toHaveBeenCalled(); // Should not try to delete DM
      expect(auth.exchangeCodeForToken).toHaveBeenCalledWith('mock-code');
      expect(auth.storeUserToken).toHaveBeenCalledWith('123456789', 'mock-token');
      expect(message.channel.send).toHaveBeenCalledWith(
        expect.stringMatching(/Authorization successful!/)
      );
    });
    
    it('should handle spoiler-tagged codes properly', async () => {
      const message = createMockMessage(true);
      await handleAuthCommand(message, ['code', '||mock-code||']);
      
      expect(auth.exchangeCodeForToken).toHaveBeenCalledWith('mock-code'); // Spoiler tags removed
      expect(auth.storeUserToken).toHaveBeenCalledWith('123456789', 'mock-token');
    });
    
    it('should handle failed code exchange', async () => {
      const message = createMockMessage(true);
      auth.exchangeCodeForToken.mockResolvedValueOnce(null);
      
      await handleAuthCommand(message, ['code', 'invalid-code']);
      
      expect(auth.exchangeCodeForToken).toHaveBeenCalledWith('invalid-code');
      expect(auth.storeUserToken).not.toHaveBeenCalled();
      expect(message.channel.send).toHaveBeenCalledWith(
        expect.stringMatching(/Authorization failed/)
      );
    });
  });
  
  describe('auth status command', () => {
    it('should show authorized status for users with token', async () => {
      const message = createMockMessage();
      auth.hasValidToken.mockReturnValueOnce(true);
      
      await handleAuthCommand(message, ['status']);
      
      expect(auth.hasValidToken).toHaveBeenCalledWith('123456789');
      expect(message.channel.send).toHaveBeenCalledWith(
        expect.stringMatching(/You have a valid authorization token/)
      );
    });
    
    it('should show unauthorized status for users without token', async () => {
      const message = createMockMessage();
      auth.hasValidToken.mockReturnValueOnce(false);
      
      await handleAuthCommand(message, ['status']);
      
      expect(auth.hasValidToken).toHaveBeenCalledWith('123456789');
      expect(message.channel.send).toHaveBeenCalledWith(
        expect.stringMatching(/You don't have an authorization token/)
      );
    });
  });
  
  describe('auth revoke command', () => {
    it('should revoke user authorization', async () => {
      const message = createMockMessage();
      
      await handleAuthCommand(message, ['revoke']);
      
      expect(auth.deleteUserToken).toHaveBeenCalledWith('123456789');
      expect(message.channel.send).toHaveBeenCalledWith(
        expect.stringMatching(/Your authorization has been revoked/)
      );
    });
    
    it('should handle failed revocation', async () => {
      const message = createMockMessage();
      auth.deleteUserToken.mockResolvedValueOnce(false);
      
      await handleAuthCommand(message, ['revoke']);
      
      expect(auth.deleteUserToken).toHaveBeenCalledWith('123456789');
      expect(message.channel.send).toHaveBeenCalledWith(
        expect.stringMatching(/Failed to revoke authorization/)
      );
    });
  });
  
  describe('general auth command behavior', () => {
    it('should show help when no subcommand is provided', async () => {
      const message = createMockMessage();
      
      await handleAuthCommand(message, []);
      
      expect(message.channel.send).toHaveBeenCalledWith(
        expect.stringMatching(/Authorization Commands/)
      );
    });
    
    it('should handle unknown subcommands', async () => {
      const message = createMockMessage();
      
      await handleAuthCommand(message, ['invalid']);
      
      expect(message.channel.send).toHaveBeenCalledWith(
        expect.stringMatching(/Unknown auth subcommand/)
      );
    });
  });
});