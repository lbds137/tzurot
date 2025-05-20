/**
 * Tests for the list command handler
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../src/logger');
jest.mock('../../../config', () => ({
  botPrefix: '!tz'
}));

jest.mock('../../../src/personalityManager', () => ({
  listPersonalitiesForUser: jest.fn()
}));

jest.mock('../../../src/embedHelpers', () => ({
  createListEmbed: jest.fn().mockReturnValue({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis()
  })
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
const personalityManager = require('../../../src/personalityManager');
const embedHelpers = require('../../../src/embedHelpers');

describe('List Command', () => {
  let listCommand;
  let mockMessage;
  let mockEmbed;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock message with standard channel.send mock
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{ title: 'Your Personalities' }]
    });
    
    // Set up mockEmbed
    mockEmbed = {
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis()
    };
    
    // Set up sample personalities
    const mockPersonalities = [
      {
        fullName: 'test-personality-1',
        displayName: 'Test Personality 1',
        avatarUrl: 'https://example.com/avatar1.png'
      },
      {
        fullName: 'test-personality-2',
        displayName: 'Test Personality 2',
        avatarUrl: 'https://example.com/avatar2.png'
      }
    ];
    
    // Configure mock implementations
    personalityManager.listPersonalitiesForUser.mockReturnValue(mockPersonalities);
    embedHelpers.createListEmbed.mockReturnValue(mockEmbed);
    
    // Import command module after mock setup
    listCommand = require('../../../src/commands/handlers/list');
  });
  
  it('should show a message when the user has no personalities', async () => {
    // Mock empty personalities list
    personalityManager.listPersonalitiesForUser.mockReturnValueOnce([]);
    
    const result = await listCommand.execute(mockMessage, []);
    
    // Verify that createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify personalities were checked for the user
    expect(personalityManager.listPersonalitiesForUser).toHaveBeenCalledWith(mockMessage.author.id);
    
    // Verify the empty message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('You haven\'t added any personalities yet')
    );
  });
  
  it('should display personalities list with default page', async () => {
    const result = await listCommand.execute(mockMessage, []);
    
    // Verify that createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify embedHelpers.createListEmbed was called with the right parameters
    expect(embedHelpers.createListEmbed).toHaveBeenCalledWith(
      expect.any(Array), // personalities
      1, // page
      expect.any(Number), // totalPages
      mockMessage.author // user
    );
    
    // Verify the message was sent with the embed
    expect(mockMessage.channel.send).toHaveBeenCalledWith({ embeds: [mockEmbed] });
  });
  
  it('should handle pagination correctly', async () => {
    // Create a large list of personalities for pagination testing
    const largeList = Array(15).fill().map((_, i) => ({
      fullName: `test-personality-${i+1}`,
      displayName: `Test Personality ${i+1}`,
      avatarUrl: `https://example.com/avatar${i+1}.png`
    }));
    
    personalityManager.listPersonalitiesForUser.mockReturnValueOnce(largeList);
    
    // Test with page 2
    const result = await listCommand.execute(mockMessage, ['2']);
    
    // Verify embedHelpers.createListEmbed was called with the right parameters
    expect(embedHelpers.createListEmbed).toHaveBeenCalledWith(
      expect.any(Array), // personalities
      2, // page
      expect.any(Number), // totalPages
      mockMessage.author // user
    );
    
    // Verify the message was sent with the embed
    expect(mockMessage.channel.send).toHaveBeenCalledWith({ embeds: [mockEmbed] });
  });
  
  it('should handle invalid page numbers', async () => {
    // Create list of personalities
    const personalities = Array(15).fill().map((_, i) => ({
      fullName: `test-personality-${i+1}`,
      displayName: `Test Personality ${i+1}`
    }));
    
    personalityManager.listPersonalitiesForUser.mockReturnValueOnce(personalities);
    
    // Test with invalid page number (too high)
    const result = await listCommand.execute(mockMessage, ['10']);
    
    // Verify an error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Invalid page number')
    );
  });
  
  it('should handle non-numeric page argument', async () => {
    // Test with non-numeric page
    const result = await listCommand.execute(mockMessage, ['abc']);
    
    // Should default to page 1
    expect(embedHelpers.createListEmbed).toHaveBeenCalledWith(
      expect.any(Array), // personalities
      1, // page
      expect.any(Number), // totalPages
      mockMessage.author // user
    );
  });
  
  it('should handle errors properly', async () => {
    // Force an error
    embedHelpers.createListEmbed.mockImplementationOnce(() => {
      throw new Error('Test error in list command');
    });
    
    const result = await listCommand.execute(mockMessage, []);
    
    // Verify logger.error was called
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error in list command:'),
      expect.any(Error)
    );
    
    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('An error occurred while listing personalities:')
    );
  });
  
  it('should expose correct metadata', () => {
    expect(listCommand.meta).toBeDefined();
    expect(listCommand.meta.name).toBe('list');
    expect(listCommand.meta.description).toBeTruthy();
  });
});