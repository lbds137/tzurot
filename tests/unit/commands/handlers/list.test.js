/**
 * Tests for the list command handler
 * Consolidates tests from multiple files into standardized format
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));

// Mock personality manager
jest.mock('../../../../src/core/personality', () => ({
  listPersonalitiesForUser: jest.fn()
}));

// Mock embed builders
jest.mock('../../../../src/utils/embedBuilders', () => ({
  createListEmbed: jest.fn()
}));

// Mock command validator
jest.mock('../../../../src/commands/utils/commandValidator', () => ({
  createDirectSend: jest.fn()
}));

// Import the test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mock dependencies
const logger = require('../../../../src/logger');
const personalityManager = require('../../../../src/core/personality');
const embedHelpers = require('../../../../src/utils/embedBuilders');
const validator = require('../../../../src/commands/utils/commandValidator');

describe('List Command', () => {
  let listCommand;
  let mockMessage;
  let mockDirectSend;
  let mockEmbed;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Set up logger mock
    logger.error = jest.fn();
    logger.info = jest.fn();
    
    // Create mock message
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{ title: 'Your Personalities' }]
    });
    
    // Create mock embed
    mockEmbed = {
      title: 'Your Personalities',
      description: 'List of your personalities'
    };
    
    // Mock direct send function
    mockDirectSend = jest.fn().mockImplementation(content => {
      return mockMessage.channel.send(content);
    });
    
    // Set up validator mock
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
    // Mock embedHelpers.createListEmbed
    embedHelpers.createListEmbed.mockReturnValue(mockEmbed);
    
    // Import the command after setting up mocks
    listCommand = require('../../../../src/commands/handlers/list');
  });
  
  it('should have the correct metadata', () => {
    // Test metadata
    expect(listCommand.meta).toEqual({
      name: 'list',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  it('should handle empty personality list', async () => {
    // Mock empty personality list
    personalityManager.listPersonalitiesForUser.mockReturnValue([]);
    
    await listCommand.execute(mockMessage, []);
    
    // Verify the direct send function was created
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify personalities were requested
    expect(personalityManager.listPersonalitiesForUser).toHaveBeenCalledWith(mockMessage.author.id);
    
    // Verify message was sent with the correct content
    expect(mockDirectSend).toHaveBeenCalled();
    expect(mockDirectSend.mock.calls[0][0]).toContain("haven't added any personalities");
    
    // The embed creator should not be called
    expect(embedHelpers.createListEmbed).not.toHaveBeenCalled();
  });
  
  it('should handle personalities list with default page', async () => {
    // Mock some personalities
    const mockPersonalities = [
      { fullName: 'test-1', displayName: 'Test One' },
      { fullName: 'test-2', displayName: 'Test Two' },
    ];
    personalityManager.listPersonalitiesForUser.mockReturnValue(mockPersonalities);
    
    // Execute command
    await listCommand.execute(mockMessage, []);
    
    // Verify personalities were requested
    expect(personalityManager.listPersonalitiesForUser).toHaveBeenCalledWith(mockMessage.author.id);
    
    // Check that the embed is created with correct parameters
    expect(embedHelpers.createListEmbed).toHaveBeenCalledWith(
      mockPersonalities, // all personalities (no pagination needed)
      1, // page 1
      1, // total pages (only 1 for this test)
      mockMessage.author // author
    );
    
    // Check the direct send function was called with the embed
    expect(mockDirectSend).toHaveBeenCalledWith({ embeds: [mockEmbed] });
  });
  
  it('should handle specific page request', async () => {
    // Create many personalities to test pagination
    const mockPersonalities = Array(30).fill().map((_, i) => ({
      fullName: `test-${i}`,
      displayName: `Test ${i}`
    }));
    personalityManager.listPersonalitiesForUser.mockReturnValue(mockPersonalities);
    
    // Call the function with page 2
    await listCommand.execute(mockMessage, ['2']);
    
    // Check that page 2 is requested with correct slicing
    expect(embedHelpers.createListEmbed).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ fullName: 'test-10' })]), // Should start from index 10
      2, // page 2
      3, // total pages (30 items with 10 per page = 3 pages)
      mockMessage.author
    );
    
    // Verify the embed was sent
    expect(mockDirectSend).toHaveBeenCalledWith({ embeds: [mockEmbed] });
  });
  
  it('should handle non-numeric page argument', async () => {
    // Mock some personalities
    const mockPersonalities = Array(30).fill().map((_, i) => ({
      fullName: `test-${i}`,
      displayName: `Test ${i}`
    }));
    personalityManager.listPersonalitiesForUser.mockReturnValue(mockPersonalities);
    
    // Call with non-numeric page
    await listCommand.execute(mockMessage, ['not-a-number']);
    
    // Should default to page 1
    expect(embedHelpers.createListEmbed).toHaveBeenCalledWith(
      expect.any(Array),
      1, // default to page 1
      3, // total pages
      mockMessage.author
    );
    
    // Verify the embed was sent
    expect(mockDirectSend).toHaveBeenCalledWith({ embeds: [mockEmbed] });
  });
  
  it('should return error when page number is out of range', async () => {
    // Mock some personalities
    const mockPersonalities = Array(30).fill().map((_, i) => ({
      fullName: `test-${i}`,
      displayName: `Test ${i}`
    }));
    personalityManager.listPersonalitiesForUser.mockReturnValue(mockPersonalities);
    
    // Call with page number out of range
    await listCommand.execute(mockMessage, ['100']);
    
    // Should return an error message
    expect(mockDirectSend).toHaveBeenCalled();
    expect(mockDirectSend.mock.calls[0][0]).toContain("Invalid page number");
    
    // The embed creator should not be called
    expect(embedHelpers.createListEmbed).not.toHaveBeenCalled();
  });
  
  it('should return error when page number is below 1', async () => {
    // Mock some personalities
    const mockPersonalities = Array(30).fill().map((_, i) => ({
      fullName: `test-${i}`,
      displayName: `Test ${i}`
    }));
    personalityManager.listPersonalitiesForUser.mockReturnValue(mockPersonalities);
    
    // Call with page number below 1
    await listCommand.execute(mockMessage, ['0']);
    
    // Should return an error message
    expect(mockDirectSend).toHaveBeenCalled();
    expect(mockDirectSend.mock.calls[0][0]).toContain("Invalid page number");
    
    // The embed creator should not be called
    expect(embedHelpers.createListEmbed).not.toHaveBeenCalled();
  });
  
  it('should handle error in personality lookup', async () => {
    // Make personalityManager throw an error
    const testError = new Error('Test error');
    personalityManager.listPersonalitiesForUser.mockImplementation(() => {
      throw testError;
    });
    
    // Call the function
    await listCommand.execute(mockMessage, []);
    
    // Check error was logged
    expect(logger.error).toHaveBeenCalledWith(
      'Error in list command:',
      testError
    );
    
    // Check error message was sent to user
    expect(mockDirectSend).toHaveBeenCalled();
    expect(mockDirectSend.mock.calls[0][0]).toContain("An error occurred");
    expect(mockDirectSend.mock.calls[0][0]).toContain("Test error");
  });
  
  it('should handle null personalities list', async () => {
    // Mock null personality list
    personalityManager.listPersonalitiesForUser.mockReturnValue(null);
    
    await listCommand.execute(mockMessage, []);
    
    // Verify message was sent about no personalities
    expect(mockDirectSend).toHaveBeenCalled();
    expect(mockDirectSend.mock.calls[0][0]).toContain("haven't added any personalities");
    
    // The embed creator should not be called
    expect(embedHelpers.createListEmbed).not.toHaveBeenCalled();
  });
});