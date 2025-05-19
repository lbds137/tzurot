// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../src/logger');
jest.mock('../../../config');
jest.mock('../../../src/conversationManager');
jest.mock('../../../src/personalityManager');

// Import mocked modules
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../src/logger');
const config = require('../../../config');
const conversationManager = require('../../../src/conversationManager');
const personalityManager = require('../../../src/personalityManager');

describe('Reset Command', () => {
  let resetCommand;
  let mockMessage;
  let mockAuthor;
  let mockChannel;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset modules
    jest.resetModules();
    
    // Mock config
    config.botPrefix = '!tz';
    
    // Create mock author
    mockAuthor = {
      id: 'user-123',
      tag: 'User#1234'
    };
    
    // Create mock channel
    mockChannel = {
      id: 'channel-123',
      send: jest.fn().mockResolvedValue({ id: 'sent-message-123' }),
      isDMBased: jest.fn().mockReturnValue(false)
    };
    
    // Create mock message
    mockMessage = {
      id: 'message-123',
      author: mockAuthor,
      channel: mockChannel,
      reply: jest.fn().mockResolvedValue({ id: 'reply-123' })
    };
    
    // Mock personality manager functions
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png'
    };
    
    personalityManager.getPersonality = jest.fn().mockReturnValue(mockPersonality);
    personalityManager.getPersonalityByAlias = jest.fn().mockReturnValue(null);
    
    // Mock conversation manager functions
    conversationManager.clearConversation = jest.fn().mockReturnValue(true);
    
    // Import the reset command after setting up mocks
    resetCommand = require('../../../src/commands/handlers/reset');
  });

  it('should have the correct metadata', () => {
    expect(resetCommand.meta).toEqual({
      name: 'reset',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });

  it('should require a personality name or alias', async () => {
    await resetCommand.execute(mockMessage, []);
    
    expect(mockChannel.send).toHaveBeenCalled();
    const message = mockChannel.send.mock.calls[0][0];
    expect(message).toContain('You need to provide a personality name');
  });

  it('should reset a conversation by personality name', async () => {
    await resetCommand.execute(mockMessage, ['test-personality']);
    
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    expect(conversationManager.clearConversation).toHaveBeenCalledWith(
      mockAuthor.id,
      mockChannel.id,
      'test-personality'
    );
    
    expect(mockChannel.send).toHaveBeenCalled();
    const message = mockChannel.send.mock.calls[0][0];
    expect(message).toContain('has been reset');
  });

  it('should try to find personality by alias first', async () => {
    // Mock getPersonalityByAlias to return a personality this time
    const mockAliasPersonality = {
      fullName: 'alias-personality',
      displayName: 'Alias Personality',
      avatarUrl: 'https://example.com/alias-avatar.png'
    };
    personalityManager.getPersonalityByAlias = jest.fn().mockReturnValue(mockAliasPersonality);
    
    await resetCommand.execute(mockMessage, ['test-alias']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(mockAuthor.id, 'test-alias');
    expect(personalityManager.getPersonality).not.toHaveBeenCalled(); // Shouldn't get to this fallback
    expect(conversationManager.clearConversation).toHaveBeenCalledWith(
      mockAuthor.id,
      mockChannel.id,
      'alias-personality'
    );
  });

  it('should handle non-existent personality', async () => {
    // Mock both functions to return null (personality not found)
    personalityManager.getPersonalityByAlias = jest.fn().mockReturnValue(null);
    personalityManager.getPersonality = jest.fn().mockReturnValue(null);
    
    await resetCommand.execute(mockMessage, ['nonexistent-personality']);
    
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(mockAuthor.id, 'nonexistent-personality');
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('nonexistent-personality');
    expect(conversationManager.clearConversation).not.toHaveBeenCalled();
    
    expect(mockChannel.send).toHaveBeenCalled();
    const message = mockChannel.send.mock.calls[0][0];
    expect(message).toContain('not found');
  });

  it('should handle errors gracefully', async () => {
    // Mock conversation manager to throw an error
    conversationManager.clearConversation = jest.fn().mockImplementation(() => {
      throw new Error('Test error');
    });
    
    await resetCommand.execute(mockMessage, ['test-personality']);
    
    expect(logger.error).toHaveBeenCalled();
    expect(mockChannel.send).toHaveBeenCalled();
    const message = mockChannel.send.mock.calls[0][0];
    expect(message).toContain('error occurred');
    expect(message).toContain('Test error');
  });
});