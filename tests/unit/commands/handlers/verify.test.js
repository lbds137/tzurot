/**
 * Tests for the verify command handler
 * Standardized format for command testing
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
}));
jest.mock('../../../../src/auth', () => ({
  isNsfwVerified: jest.fn(),
  storeNsfwVerification: jest.fn(),
}));
jest.mock('../../../../src/utils/channelUtils', () => ({
  isChannelNSFW: jest.fn(),
}));

// Mock command validator
jest.mock('../../../../src/commands/utils/commandValidator', () => ({
  createDirectSend: jest.fn(),
}));

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const logger = require('../../../../src/logger');
const auth = require('../../../../src/auth');
const channelUtils = require('../../../../src/utils/channelUtils');
const validator = require('../../../../src/commands/utils/commandValidator');

describe('Verify Command', () => {
  let verifyCommand;
  let mockMessage;
  let mockDirectSend;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock message with guild and NSFW channel
    mockMessage = helpers.createMockMessage({
      isDM: false,
      isNSFW: true
    });
    
    // Mock direct send function
    mockDirectSend = jest.fn().mockResolvedValue({
      id: 'direct-sent-123'
    });
    
    // Set up validator mock
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
    // Mock channel utils
    channelUtils.isChannelNSFW = jest.fn().mockReturnValue(true);
    
    // Mock authentication methods
    auth.isNsfwVerified = jest.fn().mockReturnValue(false);
    auth.storeNsfwVerification = jest.fn().mockResolvedValue(true);
    
    // Import the command after setting up mocks
    verifyCommand = require('../../../../src/commands/handlers/verify');
  });
  
  it('should have the correct metadata', () => {
    expect(verifyCommand.meta).toEqual({
      name: 'verify',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  it('should inform users that DM verification must be done in a server', async () => {
    // Mock a DM channel
    mockMessage.channel.isDMBased.mockReturnValueOnce(true);
    
    await verifyCommand.execute(mockMessage, []);
    
    helpers.verifyErrorResponse(mockDirectSend, { 
      contains: 'Age Verification Required'
    });
    
    helpers.verifyErrorResponse(mockDirectSend, { 
      contains: 'This command must be run in a server channel'
    });
  });
  
  it('should inform users they are already verified', async () => {
    // Mock user as already verified
    auth.isNsfwVerified.mockReturnValueOnce(true);
    
    await verifyCommand.execute(mockMessage, []);
    
    helpers.verifySuccessResponse(mockDirectSend, {
      contains: 'Already Verified'
    });
    
    expect(auth.storeNsfwVerification).not.toHaveBeenCalled();
  });
  
  it('should verify users who run the command in an NSFW channel', async () => {
    // Mock channel as NSFW
    channelUtils.isChannelNSFW.mockReturnValueOnce(true);
    
    await verifyCommand.execute(mockMessage, []);
    
    expect(auth.storeNsfwVerification).toHaveBeenCalledWith(mockMessage.author.id, true);
    
    helpers.verifySuccessResponse(mockDirectSend, {
      contains: 'Verification Successful'
    });
  });
  
  it('should handle errors in storing verification status', async () => {
    // Mock storage failure
    auth.storeNsfwVerification.mockResolvedValueOnce(false);
    
    await verifyCommand.execute(mockMessage, []);
    
    helpers.verifyErrorResponse(mockDirectSend, { 
      contains: 'Verification Error'
    });
    
    helpers.verifyErrorResponse(mockDirectSend, { 
      contains: 'error storing your verification status'
    });
  });
  
  it('should verify users who have access to NSFW channels in the server', async () => {
    // Mock a non-NSFW channel 
    channelUtils.isChannelNSFW.mockReturnValueOnce(false);
    
    // Mock filter to return 1 NSFW channel
    mockMessage.guild.channels.cache.filter = jest.fn().mockReturnValue({
      size: 1,
      map: jest.fn().mockReturnValue(['<#nsfw-channel-123>'])
    });
    
    // Set up for NSFW channel check
    channelUtils.isChannelNSFW.mockImplementation((channel) => {
      return channel.id === 'nsfw-channel-123';
    });
    
    await verifyCommand.execute(mockMessage, []);
    
    expect(auth.storeNsfwVerification).toHaveBeenCalledWith(mockMessage.author.id, true);
    
    helpers.verifySuccessResponse(mockDirectSend, {
      contains: 'Verification Successful'
    });
    
    expect(mockDirectSend).toHaveBeenCalledWith(
      expect.stringContaining('Available NSFW channels')
    );
  });
  
  it('should inform users when they have no access to NSFW channels', async () => {
    // Mock a non-NSFW channel
    channelUtils.isChannelNSFW.mockReturnValueOnce(false);
    
    // Mock no accessible NSFW channels
    mockMessage.guild.channels.cache.filter = jest.fn().mockReturnValue({
      size: 0,
      map: jest.fn().mockReturnValue([])
    });
    
    await verifyCommand.execute(mockMessage, []);
    
    expect(auth.storeNsfwVerification).not.toHaveBeenCalled();
    
    helpers.verifyErrorResponse(mockDirectSend, { 
      contains: 'Unable to Verify'
    });
    
    helpers.verifyErrorResponse(mockDirectSend, { 
      contains: 'you don\'t have access to any NSFW channels'
    });
  });
  
  it('should handle missing guild information', async () => {
    // Mock a non-NSFW channel
    channelUtils.isChannelNSFW.mockReturnValueOnce(false);
    
    // Remove guild from message
    mockMessage.guild = null;
    
    await verifyCommand.execute(mockMessage, []);
    
    helpers.verifyErrorResponse(mockDirectSend, { 
      contains: 'Verification Error'
    });
    
    helpers.verifyErrorResponse(mockDirectSend, { 
      contains: 'Unable to verify server information'
    });
  });
  
  it('should handle unexpected errors during verification', async () => {
    // Mock a non-NSFW channel
    channelUtils.isChannelNSFW.mockReturnValueOnce(false);
    
    // Force an error
    mockMessage.guild.channels.cache.filter = jest.fn().mockImplementation(() => {
      throw new Error('Test error');
    });
    
    await verifyCommand.execute(mockMessage, []);
    
    expect(logger.error).toHaveBeenCalled();
    
    helpers.verifyErrorResponse(mockDirectSend, { 
      contains: 'Verification Error'
    });
    
    helpers.verifyErrorResponse(mockDirectSend, { 
      contains: 'Test error'
    });
  });
});