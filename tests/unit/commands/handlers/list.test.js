// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
}));
jest.mock('../../../../src/personalityManager', () => ({
  listPersonalitiesForUser: jest.fn(),
  personalityAliases: new Map(),
}));
jest.mock('../../../../src/embedHelpers', () => ({
  createPersonalityListEmbed: jest.fn(),
  createListEmbed: jest.fn()
}));
jest.mock('../../../../src/commands/utils/commandValidator');

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../../src/logger');
const personalityManager = require('../../../../src/personalityManager');
const embedHelpers = require('../../../../src/embedHelpers');
const validator = require('../../../../src/commands/utils/commandValidator');

describe('List Command', () => {
  let listCommand;
  let mockMessage;
  let mockDirectSend;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset modules
    jest.resetModules();
    
    // Mock EmbedBuilder
    EmbedBuilder.mockImplementation(() => ({
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({ 
        title: 'Your Personalities',
        description: 'List of your personalities'
      }),
    }));
    
    // Create mock message
    mockMessage = helpers.createMockMessage();
    
    // Mock direct send function
    mockDirectSend = jest.fn().mockResolvedValue({
      id: 'direct-sent-123'
    });
    
    // Mock validator
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
    // Mock embedHelpers.createListEmbed
    embedHelpers.createListEmbed.mockImplementation((personalities, page, totalPages, author) => ({
      title: `Your Personalities (Page ${page}/${totalPages})`,
      description: `You have ${personalities.length} personalities on this page`,
    }));
    
    // Import the command after setting up mocks
    listCommand = require('../../../../src/commands/handlers/list');
  });
  
  it('should have the correct metadata', () => {
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
    
    // Verify message was sent about no personalities
    helpers.verifyErrorResponse(mockDirectSend, {
      contains: "haven't added any personalities"
    });
    
    // The embed creator should not be called
    expect(embedHelpers.createListEmbed).not.toHaveBeenCalled();
  });
  
  it('should handle personalities list with default page', async () => {
    // Mock some personalities
    personalityManager.listPersonalitiesForUser.mockReturnValue([
      { fullName: 'test-1', displayName: 'Test One' },
      { fullName: 'test-2', displayName: 'Test Two' },
    ]);
    
    await listCommand.execute(mockMessage, []);
    
    // Verify the personalities were retrieved
    expect(personalityManager.listPersonalitiesForUser).toHaveBeenCalledWith(mockMessage.author.id);
    
    // Check that the embed is created with correct parameters
    expect(embedHelpers.createListEmbed).toHaveBeenCalledWith(
      expect.any(Array), // personalities slice
      1, // page 1
      1, // total pages (only 1 for this test)
      mockMessage.author // author
    );
    
    // Check the reply includes the embeds
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true
    });
  });
  
  it('should handle specific page request', async () => {
    // Mock some personalities
    personalityManager.listPersonalitiesForUser.mockReturnValue(Array(30).fill({ fullName: 'test', displayName: 'Test' }));
    
    // Call the function with page 2
    await listCommand.execute(mockMessage, ['2']);
    
    // Check that page 2 is requested
    expect(embedHelpers.createListEmbed).toHaveBeenCalledWith(
      expect.any(Array),
      2, // page 2
      expect.any(Number),
      mockMessage.author
    );
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true
    });
  });
  
  it('should handle invalid page number', async () => {
    // Mock some personalities
    personalityManager.listPersonalitiesForUser.mockReturnValue(Array(30).fill({ fullName: 'test', displayName: 'Test' }));
    
    // Call the function with an invalid page
    await listCommand.execute(mockMessage, ['not-a-number']);
    
    // Should use default page 1
    expect(embedHelpers.createListEmbed).toHaveBeenCalledWith(
      expect.any(Array),
      1, // default page 1
      expect.any(Number),
      mockMessage.author
    );
    
    helpers.verifySuccessResponse(mockDirectSend, {
      isEmbed: true
    });
  });
  
  it('should return error when invalid page number range is provided', async () => {
    // Mock some personalities
    personalityManager.listPersonalitiesForUser.mockReturnValue(Array(30).fill({ fullName: 'test', displayName: 'Test' }));
    
    // Call the function with a page number out of range
    await listCommand.execute(mockMessage, ['100']);
    
    // Should return an error message
    helpers.verifyErrorResponse(mockDirectSend, {
      contains: "Invalid page number"
    });
    
    // The embed creator should not be called
    expect(embedHelpers.createListEmbed).not.toHaveBeenCalled();
  });
  
  it('should handle error in personality lookup', async () => {
    // Make personalityManager throw an error
    personalityManager.listPersonalitiesForUser.mockImplementation(() => {
      throw new Error('Test error');
    });
    
    // Call the function
    await listCommand.execute(mockMessage, []);
    
    // Check error handling
    expect(logger.error).toHaveBeenCalled();
    helpers.verifyErrorResponse(mockDirectSend, {
      contains: "An error occurred"
    });
  });
});