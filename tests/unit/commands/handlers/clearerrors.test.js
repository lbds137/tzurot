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

// Mock utils and commandValidator
jest.mock('../../../../src/utils', () => ({
  createDirectSend: jest.fn().mockImplementation((message) => {
    return async (content) => {
      return message.channel.send(content);
    };
  })
}));

jest.mock('../../../../src/commands/utils/commandValidator', () => {
  return {
    createDirectSend: jest.fn().mockImplementation((message) => {
      return async (content) => {
        return message.channel.send(content);
      };
    }),
    isAdmin: jest.fn()
  };
});

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
    
    // Import the aiService module again to get fresh mocks
    const aiService = require('../../../../src/aiService');
    
    // Mock config
    config.botPrefix = '!tz';
    
    // Create mock message
    mockMessage = helpers.createMockMessage({
      isAdmin: true,
      isDM: false
    });
    
    // Set up channel.send mock for testing
    mockMessage.channel.send = jest.fn().mockImplementation(content => {
      return Promise.resolve({
        id: 'sent-message-123',
        content: typeof content === 'string' ? content : JSON.stringify(content)
      });
    });
    
    // Mock validator.isAdmin behavior
    validator.isAdmin.mockReturnValue(true);
    
    // Import the command after setting up mocks
    jest.resetModules();
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
    
    // Check that error maps were not cleared
    expect(aiService.runtimeProblematicPersonalities.clear).not.toHaveBeenCalled();
    expect(aiService.errorBlackoutPeriods.clear).not.toHaveBeenCalled();
    
    // Verify the error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Administrator permission')
    );
  });
  
  it('should not allow command in DMs', async () => {
    // Mock DM channel
    mockMessage.channel.isDMBased.mockReturnValueOnce(true);
    
    // Mock isAdmin for DM to return false (as stated in the handler code)
    validator.isAdmin.mockReturnValueOnce(false);
    
    // Reset the collection mock implementations for this test
    aiService.runtimeProblematicPersonalities.size = 3;
    aiService.errorBlackoutPeriods.size = 5;
    
    // Make sure the mocks are reset
    mockMessage.channel.send.mockClear();
    aiService.runtimeProblematicPersonalities.clear.mockClear();
    aiService.errorBlackoutPeriods.clear.mockClear();
    
    await clearErrorsCommand.execute(mockMessage, []);
    
    // Verify the error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Administrator permission')
    );
  });
  
  it('should clear error states when run by an admin', async () => {
    // Import fresh modules for this test
    jest.resetModules();
    jest.mock('../../../../src/commands/utils/commandValidator', () => ({
      createDirectSend: jest.fn().mockImplementation((message) => {
        return async (content) => {
          return message.channel.send(content);
        };
      }),
      isAdmin: jest.fn().mockReturnValue(true)
    }));
    
    const clearErrorsCommand = require('../../../../src/commands/handlers/clearerrors');
    
    // Reset message mock
    mockMessage.channel.send.mockClear();
    
    // Verify that we can call the command
    await clearErrorsCommand.execute(mockMessage, []);
    
    // Verify success message contains expected info
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('✅ Error state has been cleared')
    );
  });
  
  it('should handle empty error collections', async () => {
    // Import fresh modules for this test with updated mocks
    jest.resetModules();
    
    // Mock validator
    jest.mock('../../../../src/commands/utils/commandValidator', () => ({
      createDirectSend: jest.fn().mockImplementation((message) => {
        return async (content) => {
          return message.channel.send(content);
        };
      }),
      isAdmin: jest.fn().mockReturnValue(true)
    }));
    
    // Mock with empty collections
    jest.mock('../../../../src/aiService', () => ({
      runtimeProblematicPersonalities: {
        size: 0,
        clear: jest.fn()
      },
      errorBlackoutPeriods: {
        size: 0,
        clear: jest.fn()
      }
    }));
    
    // Reset message mock
    mockMessage.channel.send.mockClear();
    
    // Import command with new mocks
    const clearErrorsCommand = require('../../../../src/commands/handlers/clearerrors');
    
    // Execute the command
    await clearErrorsCommand.execute(mockMessage, []);
    
    // Verify success message contains expected info
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Cleared 0 problematic personality registrations')
    );
  });
});