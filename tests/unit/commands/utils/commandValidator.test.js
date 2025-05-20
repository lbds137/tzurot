/**
 * Tests for the commandValidator utility
 */

// Mock dependencies before requiring the module
jest.mock('discord.js', () => ({
  PermissionFlagsBits: {
    Administrator: 8n,
    ManageMessages: 16n
  }
}));

jest.mock('../../../../src/logger');
jest.mock('../../../../src/utils', () => ({
  createDirectSend: jest.fn().mockImplementation((message) => {
    const directSend = async (content) => {
      return message.channel.send(content);
    };
    return directSend;
  })
}));

jest.mock('../../../../src/utils/channelUtils', () => ({
  isChannelNSFW: jest.fn()
}));

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const logger = require('../../../../src/logger');
const utils = require('../../../../src/utils');
const channelUtils = require('../../../../src/utils/channelUtils');

describe('Command Validator', () => {
  let validator;
  let regularMessage;
  let dmMessage;
  let adminMessage;
  let modMessage;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create standard mock messages
    regularMessage = helpers.createMockMessage();
    
    // Create DM mock message
    dmMessage = helpers.createMockMessage({ isDM: true });
    
    // Create admin mock message
    adminMessage = helpers.createMockMessage();
    // Override permissions for admin
    adminMessage.member.permissions.has = jest.fn().mockImplementation((permission) => {
      return permission === 8n; // Administrator
    });
    
    // Create mod mock message
    modMessage = helpers.createMockMessage();
    // Override permissions for mod
    modMessage.member.permissions.has = jest.fn().mockImplementation((permission) => {
      return permission === 16n; // ManageMessages
    });
    
    // Setup channel mocks
    channelUtils.isChannelNSFW.mockReturnValue(false);
    
    // Import module after mock setup
    validator = require('../../../../src/commands/utils/commandValidator');
  });
  
  describe('isAdmin', () => {
    it('should return false for DM channels', () => {
      const result = validator.isAdmin(dmMessage);
      expect(result).toBe(false);
      expect(dmMessage.channel.isDMBased).toHaveBeenCalled();
    });
    
    it('should return false for regular users', () => {
      const result = validator.isAdmin(regularMessage);
      expect(result).toBe(false);
      expect(regularMessage.member.permissions.has).toHaveBeenCalledWith(8n);
    });
    
    it('should return true for users with Administrator permission', () => {
      const result = validator.isAdmin(adminMessage);
      expect(result).toBe(true);
      expect(adminMessage.member.permissions.has).toHaveBeenCalledWith(8n);
    });
    
    it('should handle cases with no member object', () => {
      // Create message with no member
      const noMemberMessage = { ...regularMessage, member: null };
      
      const result = validator.isAdmin(noMemberMessage);
      expect(result).toBe(false);
    });
  });
  
  describe('canManageMessages', () => {
    it('should return false for DM channels', () => {
      const result = validator.canManageMessages(dmMessage);
      expect(result).toBe(false);
      expect(dmMessage.channel.isDMBased).toHaveBeenCalled();
    });
    
    it('should return false for regular users', () => {
      const result = validator.canManageMessages(regularMessage);
      expect(result).toBe(false);
      expect(regularMessage.member.permissions.has).toHaveBeenCalledWith(16n);
    });
    
    it('should return true for users with ManageMessages permission', () => {
      const result = validator.canManageMessages(modMessage);
      expect(result).toBe(true);
      expect(modMessage.member.permissions.has).toHaveBeenCalledWith(16n);
    });
    
    it('should handle cases with no member object', () => {
      // Create message with no member
      const noMemberMessage = { ...regularMessage, member: null };
      
      const result = validator.canManageMessages(noMemberMessage);
      expect(result).toBe(false);
    });
  });
  
  describe('isNsfwChannel', () => {
    it('should use channelUtils.isChannelNSFW', () => {
      const mockChannel = { id: 'channel-123' };
      
      // First with false
      channelUtils.isChannelNSFW.mockReturnValueOnce(false);
      expect(validator.isNsfwChannel(mockChannel)).toBe(false);
      
      // Then with true
      channelUtils.isChannelNSFW.mockReturnValueOnce(true);
      expect(validator.isNsfwChannel(mockChannel)).toBe(true);
      
      expect(channelUtils.isChannelNSFW).toHaveBeenCalledTimes(2);
      expect(channelUtils.isChannelNSFW).toHaveBeenCalledWith(mockChannel);
    });
  });
  
  describe('createDirectSend', () => {
    it('should use utils.createDirectSend', () => {
      const mockMessage = { id: 'message-123' };
      validator.createDirectSend(mockMessage);
      
      expect(utils.createDirectSend).toHaveBeenCalledWith(mockMessage);
    });
    
    it('should return a function that calls message.channel.send', async () => {
      // Setup message mock
      const mockMessage = helpers.createMockMessage();
      mockMessage.channel.send = jest.fn().mockResolvedValue({ id: 'sent-123' });
      
      // Get directSend function
      const directSend = validator.createDirectSend(mockMessage);
      
      // Call the function
      const result = await directSend('test message');
      
      // Verify it called message.channel.send
      expect(mockMessage.channel.send).toHaveBeenCalledWith('test message');
      expect(result).toEqual({ id: 'sent-123' });
    });
  });
  
  describe('getPermissionErrorMessage', () => {
    it('should return admin error for ADMINISTRATOR permission', () => {
      const message = validator.getPermissionErrorMessage('ADMINISTRATOR', 'test');
      expect(message).toContain('Administrator permission');
      expect(message).toContain('test command');
    });
    
    it('should return mod error for MANAGE_MESSAGES permission', () => {
      const message = validator.getPermissionErrorMessage('MANAGE_MESSAGES', 'test');
      expect(message).toContain('Manage Messages');
      expect(message).toContain('test command');
    });
    
    it('should return NSFW error for NSFW_CHANNEL permission', () => {
      const message = validator.getPermissionErrorMessage('NSFW_CHANNEL', 'test');
      expect(message).toContain('NSFW');
      expect(message).not.toContain('test command');
    });
    
    it('should return generic error for unknown permissions', () => {
      const message = validator.getPermissionErrorMessage('UNKNOWN', 'test');
      expect(message).toContain('don\'t have permission');
      expect(message).toContain('test command');
    });
  });
});