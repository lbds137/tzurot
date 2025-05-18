// Test suite for the list command functionality
const commands = require('../../src/commands');
const embedHelpers = require('../../src/embedHelpers');
const personalityManager = require('../../src/personalityManager');
const logger = require('../../src/logger');

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
  });
  
  test('properly handles a user with personalities', async () => {
    // Set up test data
    const testPersonalities = [
      { fullName: 'test-1', displayName: 'Test One' },
      { fullName: 'test-2', displayName: 'Test Two' },
    ];
    
    // Set up mocks
    personalityManager.listPersonalitiesForUser.mockReturnValue(testPersonalities);
    embedHelpers.createPersonalityListEmbed.mockReturnValue({ id: 'mock-embed' });
    
    // Call the function
    await commands.processCommand(mockMessage, 'list', []);
    
    // Verify the correct functions were called
    expect(personalityManager.listPersonalitiesForUser).toHaveBeenCalledWith(mockMessage.author.id);
    expect(embedHelpers.createPersonalityListEmbed).toHaveBeenCalledWith(mockMessage.author.id);
    
    // Verify the message reply was sent
    expect(mockMessage.reply).toHaveBeenCalledWith({ embeds: [{ id: 'mock-embed' }] });
    
    // Verify appropriate logging
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Found 2 personalities for user'));
  });
  
  test('properly handles a user with no personalities', async () => {
    // Set up mocks for empty personality list
    personalityManager.listPersonalitiesForUser.mockReturnValue([]);
    
    // Call the function
    await commands.processCommand(mockMessage, 'list', []);
    
    // Verify the correct functions were called
    expect(personalityManager.listPersonalitiesForUser).toHaveBeenCalledWith(mockMessage.author.id);
    
    // Verify createPersonalityListEmbed was NOT called
    expect(embedHelpers.createPersonalityListEmbed).not.toHaveBeenCalled();
    
    // Verify the message reply contained the "no personalities" message
    expect(mockMessage.reply).toHaveBeenCalledWith(expect.stringContaining("You haven't added any personalities yet"));
    
    // Verify appropriate logging
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Found 0 personalities for user'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('User has no personalities'));
  });
  
  test('properly handles error conditions', async () => {
    // Set up mocks to simulate an error
    personalityManager.listPersonalitiesForUser.mockImplementation(() => {
      throw new Error('Test error');
    });
    
    // Call the function
    await commands.processCommand(mockMessage, 'list', []);
    
    // Verify error was logged
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error processing list command'));
    
    // Verify error message was sent to user
    expect(mockMessage.reply).toHaveBeenCalledWith(expect.stringContaining('An error occurred'));
  });
  
  test('handles non-array return from listPersonalitiesForUser', async () => {
    // Set up mocks to return a non-array
    personalityManager.listPersonalitiesForUser.mockReturnValue(null);
    
    // Call the function
    await commands.processCommand(mockMessage, 'list', []);
    
    // Verify error was logged
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('personalities is not an array'));
    
    // Verify error message was sent to user
    expect(mockMessage.reply).toHaveBeenCalledWith(expect.stringContaining('An error occurred'));
  });
});