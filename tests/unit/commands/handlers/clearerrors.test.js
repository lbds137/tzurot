// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config');
jest.mock('../../../../src/aiService', () => ({
  runtimeProblematicPersonalities: {
    size: 3,
    clear: jest.fn()
  },
  errorBlackoutPeriods: {
    size: 5,
    clear: jest.fn()
  }
}));
jest.mock('../../../../src/commands/utils/commandValidator');

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const logger = require('../../../../src/logger');
const config = require('../../../../config');
const aiService = require('../../../../src/aiService');
const validator = require('../../../../src/commands/utils/commandValidator');

describe('ClearErrors Command', () => {
  let clearErrorsCommand;
  let mockMessage;
  let mockDirectSend;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset modules
    jest.resetModules();
    
    // Mock config
    config.botPrefix = '!tz';
    
    // Create mock message
    mockMessage = helpers.createMockMessage({
      isAdmin: true,
      isDM: false
    });
    
    // Mock direct send function
    mockDirectSend = jest.fn().mockResolvedValue({
      id: 'direct-sent-123'
    });
    
    // Mock validator
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    validator.isAdmin.mockReturnValue(true);
    
    // Import the command after setting up mocks
    clearErrorsCommand = require('../../../../src/commands/handlers/clearerrors');
  });
  
  it('should have the correct metadata', () => {
    expect(clearErrorsCommand.meta).toEqual({
      name: 'clearerrors',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.arrayContaining(['ADMINISTRATOR'])
    });
  });
  
  it('should require administrator permission in server channels', async () => {
    // Mock non-admin user
    validator.isAdmin.mockReturnValueOnce(false);
    
    await clearErrorsCommand.execute(mockMessage, []);
    
    // Check that we verified admin status
    expect(validator.isAdmin).toHaveBeenCalledWith(mockMessage);
    
    // Check that error maps were not cleared
    expect(aiService.runtimeProblematicPersonalities.clear).not.toHaveBeenCalled();
    expect(aiService.errorBlackoutPeriods.clear).not.toHaveBeenCalled();
    
    helpers.verifyErrorResponse(mockDirectSend, { 
      contains: 'Administrator permission' 
    });
  });
  
  it('should not allow command in DMs', async () => {
    // Mock DM channel
    mockMessage.channel.isDMBased.mockReturnValueOnce(true);
    
    // Mock isAdmin for DM to return false (as stated in the handler code)
    validator.isAdmin.mockReturnValueOnce(false);
    
    await clearErrorsCommand.execute(mockMessage, []);
    
    helpers.verifyErrorResponse(mockDirectSend, { 
      contains: 'Administrator permission'
    });
  });
  
  it('should clear error states when run by an admin', async () => {
    await clearErrorsCommand.execute(mockMessage, []);
    
    // Check that error maps were cleared
    expect(aiService.runtimeProblematicPersonalities.clear).toHaveBeenCalled();
    expect(aiService.errorBlackoutPeriods.clear).toHaveBeenCalled();
    
    helpers.verifySuccessResponse(mockDirectSend, {
      contains: 'Cleared 3 problematic personality registrations'
    });
    expect(mockDirectSend).toHaveBeenCalledWith(
      expect.stringContaining('Cleared 5 error blackout periods')
    );
  });
  
  it('should handle empty error collections', async () => {
    // Mock empty collections
    aiService.runtimeProblematicPersonalities.size = 0;
    aiService.errorBlackoutPeriods.size = 0;
    
    await clearErrorsCommand.execute(mockMessage, []);
    
    // Check that error maps were cleared
    expect(aiService.runtimeProblematicPersonalities.clear).toHaveBeenCalled();
    expect(aiService.errorBlackoutPeriods.clear).toHaveBeenCalled();
    
    helpers.verifySuccessResponse(mockDirectSend, {
      contains: 'Cleared 0 problematic personality registrations'
    });
    expect(mockDirectSend).toHaveBeenCalledWith(
      expect.stringContaining('Cleared 0 error blackout periods')
    );
  });
});