// Unit tests for the list command
const commands = require('../../src/commands');
const personalityManager = require('../../src/personalityManager');
const embedHelpers = require('../../src/embedHelpers');
const logger = require('../../src/logger');
const { botPrefix } = require('../../config');

// Mock dependencies
jest.mock('../../src/personalityManager', () => ({
  listPersonalitiesForUser: jest.fn(),
  personalityAliases: new Map(),
}));

jest.mock('../../src/embedHelpers', () => ({
  createPersonalityListEmbed: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

jest.mock('../../config', () => ({
  botPrefix: '!tz',
}));

describe('list command', () => {
  let mockMessage;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock discord.js message object
    mockMessage = {
      author: { id: 'user-123', tag: 'testuser#1234' },
      channel: { id: 'channel-123' },
      reply: jest.fn().mockImplementation(content => Promise.resolve({ content })),
      id: 'message-123',
    };
    
    // Mock createPersonalityListEmbed to return valid data
    embedHelpers.createPersonalityListEmbed.mockImplementation((userId, page = 1) => ({
      embed: {
        data: {
          title: `Your Personalities (Page ${page}/2)`,
          description: `You have 30 personalities`,
        }
      },
      totalPages: 2,
      currentPage: page,
    }));
  });
  
  test('handles empty personality list', async () => {
    // Mock empty personality list
    personalityManager.listPersonalitiesForUser.mockReturnValue([]);
    
    // Call the function
    await commands.processCommand(mockMessage, 'list', []);
    
    // Should show "no personalities" message
    expect(mockMessage.reply).toHaveBeenCalledWith(expect.stringContaining("You haven't added any personalities yet"));
    
    // The embed creator should not be called
    expect(embedHelpers.createPersonalityListEmbed).not.toHaveBeenCalled();
  });
  
  test('handles personalities list with default page', async () => {
    // Mock some personalities
    personalityManager.listPersonalitiesForUser.mockReturnValue([
      { fullName: 'test-1', displayName: 'Test One' },
      { fullName: 'test-2', displayName: 'Test Two' },
    ]);
    
    // Call the function
    await commands.processCommand(mockMessage, 'list', []);
    
    // Check that the correct page is requested (default should be 1)
    expect(embedHelpers.createPersonalityListEmbed).toHaveBeenCalledWith('user-123', 1);
    
    // Check the reply includes the embeds
    expect(mockMessage.reply).toHaveBeenCalledWith({ embeds: [expect.anything()] });
  });
  
  test('handles specific page request', async () => {
    // Mock some personalities
    personalityManager.listPersonalitiesForUser.mockReturnValue(Array(30).fill({ fullName: 'test', displayName: 'Test' }));
    
    // Call the function with page 2
    await commands.processCommand(mockMessage, 'list', ['2']);
    
    // Check that page 2 is requested
    expect(embedHelpers.createPersonalityListEmbed).toHaveBeenCalledWith('user-123', 2);
  });
  
  test('handles invalid page number', async () => {
    // Mock some personalities
    personalityManager.listPersonalitiesForUser.mockReturnValue(Array(30).fill({ fullName: 'test', displayName: 'Test' }));
    
    // Call the function with an invalid page
    await commands.processCommand(mockMessage, 'list', ['not-a-number']);
    
    // Should use default page 1
    expect(embedHelpers.createPersonalityListEmbed).toHaveBeenCalledWith('user-123', 1);
  });
  
  test('handles error from embedHelpers', async () => {
    // Mock some personalities
    personalityManager.listPersonalitiesForUser.mockReturnValue(Array(30).fill({ fullName: 'test', displayName: 'Test' }));
    
    // Make embedHelpers throw an error
    embedHelpers.createPersonalityListEmbed.mockImplementation(() => {
      throw new Error('Test error');
    });
    
    // Call the function
    await commands.processCommand(mockMessage, 'list', []);
    
    // Check error handling
    expect(logger.error).toHaveBeenCalled();
    expect(mockMessage.reply).toHaveBeenCalledWith(expect.stringContaining('An error occurred'));
  });
  
  test('handles missing response from embedHelpers', async () => {
    // Mock some personalities
    personalityManager.listPersonalitiesForUser.mockReturnValue(Array(30).fill({ fullName: 'test', displayName: 'Test' }));
    
    // Make embedHelpers return invalid data
    embedHelpers.createPersonalityListEmbed.mockReturnValue(null);
    
    // Call the function
    await commands.processCommand(mockMessage, 'list', []);
    
    // Check error handling
    expect(logger.error).toHaveBeenCalled();
    expect(mockMessage.reply).toHaveBeenCalledWith(expect.stringContaining('An error occurred'));
  });
});