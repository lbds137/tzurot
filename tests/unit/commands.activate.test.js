// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../src/personalityManager');
jest.mock('../../src/conversationManager');
jest.mock('../../src/logger');
jest.mock('../../config');

// Import mocked modules
const { PermissionFlagsBits } = require('discord.js');
const personalityManager = require('../../src/personalityManager');
const conversationManager = require('../../src/conversationManager');
const logger = require('../../src/logger');
const config = require('../../config');

describe('commands.activate', () => {
  let mockMessage;
  let mockAuthor;
  let mockChannel;
  let mockMember;
  let mockGuild;
  let commands;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    // Reset module registry between tests
    jest.resetModules();
    
    // Create mock author
    mockAuthor = {
      id: 'user-123',
      tag: 'User#1234'
    };

    // Create mock channel
    mockChannel = {
      id: 'channel-123',
      send: jest.fn().mockResolvedValue({ id: 'sent-message-123' })
    };

    // Create mock guild
    mockGuild = {
      id: 'guild-123'
    };

    // Create mock permissions
    const mockPermissions = {
      has: jest.fn().mockImplementation((flag) => true)
    };

    // Create mock member with permissions
    mockMember = {
      permissions: mockPermissions
    };

    // Create mock message
    mockMessage = {
      id: 'message-123',
      author: mockAuthor,
      channel: mockChannel,
      guild: mockGuild,
      member: mockMember,
      reply: jest.fn().mockResolvedValue({ id: 'reply-123' }),
      content: '!tz activate test-personality'
    };

    // Set NODE_ENV to test
    process.env.NODE_ENV = 'test';

    // Mock configuration
    config.botPrefix = '!tz';

    // Basic personality for testing
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png',
      description: 'Test description',
      createdBy: 'user-123',
      createdAt: Date.now()
    };

    // Multi-word personality for testing
    const mockMultiWordPersonality = {
      fullName: 'lucifer-seraph-ha-lev-nafal',
      displayName: 'Lucifer',
      avatarUrl: 'https://example.com/lucifer.png',
      description: 'Fallen angel personality',
      createdBy: 'user-123',
      createdAt: Date.now()
    };

    // Mock personalityManager functions
    personalityManager.getPersonality = jest.fn().mockImplementation((name) => {
      if (name === 'test-personality') return mockPersonality;
      if (name === 'lucifer-seraph-ha-lev-nafal') return mockMultiWordPersonality;
      return null;
    });
    
    personalityManager.getPersonalityByAlias = jest.fn().mockImplementation((alias) => {
      if (alias === 'test') return mockPersonality;
      if (alias === 'lucifer') return mockMultiWordPersonality;
      return null;
    });

    // Mock conversationManager functions
    conversationManager.activatePersonality = jest.fn().mockReturnValue(true);

    // Mock logger
    logger.info = jest.fn();
    logger.debug = jest.fn();
    logger.error = jest.fn();

    // Import the commands module after mocks are set up
    commands = require('../../src/commands');
  });

  it('should activate a personality with a simple name', async () => {
    await commands.handleActivateCommand(mockMessage, ['test-personality']);
    
    // With our implementation, expect it to first check the joined args
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith('test-personality');
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    expect(conversationManager.activatePersonality).toHaveBeenCalledWith(
      mockChannel.id, 'test-personality', mockAuthor.id
    );
    
    expect(mockMessage.reply).toHaveBeenCalled();
    const replyContent = mockMessage.reply.mock.calls[0][0];
    expect(replyContent).toContain('Channel-wide activation');
    expect(replyContent).toContain('Test Personality');
  });

  it('should activate a personality by alias', async () => {
    await commands.handleActivateCommand(mockMessage, ['test']);
    
    // First it will try the alias of the full args string 
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith('test');
    expect(conversationManager.activatePersonality).toHaveBeenCalledWith(
      mockChannel.id, 'test-personality', mockAuthor.id
    );
    
    expect(mockMessage.reply).toHaveBeenCalled();
    const replyContent = mockMessage.reply.mock.calls[0][0];
    expect(replyContent).toContain('Channel-wide activation');
    expect(replyContent).toContain('Test Personality');
  });

  it('should activate a personality with a multi-word name', async () => {
    // Reset mocks for this specific test
    jest.clearAllMocks();
    
    // Set expectations for this test case
    personalityManager.getPersonality.mockImplementation((name) => {
      if (name === 'lucifer-seraph-ha-lev-nafal') return {
        fullName: 'lucifer-seraph-ha-lev-nafal',
        displayName: 'Lucifer'
      };
      return null;
    });
    
    await commands.handleActivateCommand(mockMessage, ['lucifer-seraph-ha-lev-nafal']);
    
    // With our implementation, first it will try the alias
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith('lucifer-seraph-ha-lev-nafal');
    // Then it will try full name
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('lucifer-seraph-ha-lev-nafal');
    expect(conversationManager.activatePersonality).toHaveBeenCalledWith(
      mockChannel.id, 'lucifer-seraph-ha-lev-nafal', mockAuthor.id
    );
    
    expect(mockMessage.reply).toHaveBeenCalled();
    const replyContent = mockMessage.reply.mock.calls[0][0];
    expect(replyContent).toContain('Channel-wide activation');
    expect(replyContent).toContain('Lucifer');
  });

  it('should handle multi-word personality names passed as separate arguments', async () => {
    // Reset mocks for this specific test
    jest.clearAllMocks();
    
    // Set expectations for this test case
    personalityManager.getPersonality.mockImplementation((name) => {
      if (name === 'lucifer-seraph-ha-lev-nafal') return {
        fullName: 'lucifer-seraph-ha-lev-nafal',
        displayName: 'Lucifer'
      };
      return null;
    });
    
    // Test with the arguments split across the array as they would be from command parsing
    await commands.handleActivateCommand(mockMessage, ['lucifer', 'seraph', 'ha', 'lev', 'nafal']);
    
    // We now expect the function to join the arguments with hyphens
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith('lucifer-seraph-ha-lev-nafal');
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('lucifer-seraph-ha-lev-nafal');
    expect(conversationManager.activatePersonality).toHaveBeenCalledWith(
      mockChannel.id, 'lucifer-seraph-ha-lev-nafal', mockAuthor.id
    );
    
    expect(mockMessage.reply).toHaveBeenCalled();
    const replyContent = mockMessage.reply.mock.calls[0][0];
    expect(replyContent).toContain('Channel-wide activation');
    expect(replyContent).toContain('Lucifer');
  });

  it('should handle the case where the user has insufficient permissions', async () => {
    // Override permissions mock to return false for ManageMessages
    mockMember.permissions.has = jest.fn().mockImplementation((flag) => {
      return flag !== PermissionFlagsBits.ManageMessages;
    });
    
    await commands.handleActivateCommand(mockMessage, ['test-personality']);
    
    // Verify that activatePersonality was not called
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();
    
    // Verify the error message
    expect(mockMessage.reply).toHaveBeenCalled();
    const replyContent = mockMessage.reply.mock.calls[0][0];
    expect(replyContent).toContain('need the "Manage Messages" permission');
  });

  it('should handle the case where no personality name is provided', async () => {
    await commands.handleActivateCommand(mockMessage, []);
    
    // Verify that activatePersonality was not called
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();
    
    // Verify the error message
    expect(mockMessage.reply).toHaveBeenCalled();
    const replyContent = mockMessage.reply.mock.calls[0][0];
    expect(replyContent).toContain('Please provide a personality name');
  });

  it('should handle the case where the personality is not found', async () => {
    // Reset mocks for this specific test
    jest.clearAllMocks();
    
    // Ensure all personality lookups return null
    personalityManager.getPersonalityByAlias.mockReturnValue(null);
    personalityManager.getPersonality.mockReturnValue(null);
    
    await commands.handleActivateCommand(mockMessage, ['nonexistent-personality']);
    
    // Verify that we tried to lookup the personality
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith('nonexistent-personality');
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('nonexistent-personality');
    
    // Verify that activatePersonality was not called
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();
    
    // Verify the error message
    expect(mockMessage.reply).toHaveBeenCalled();
    const replyContent = mockMessage.reply.mock.calls[0][0];
    expect(replyContent).toContain('not found');
  });

  it('should fall back to first argument if multi-word personality is not found', async () => {
    // Reset mocks for this specific test
    jest.clearAllMocks();
    
    // Set up getPersonalityByAlias to return null for the joined args
    // but return a valid personality for the first arg only
    personalityManager.getPersonalityByAlias.mockImplementation((alias) => {
      if (alias === 'lucifer') return {
        fullName: 'lucifer',
        displayName: 'Lucifer',
        avatarUrl: 'https://example.com/lucifer.png'
      };
      return null;
    });
    
    personalityManager.getPersonality.mockImplementation((name) => {
      if (name === 'lucifer') return {
        fullName: 'lucifer',
        displayName: 'Lucifer',
        avatarUrl: 'https://example.com/lucifer.png'
      };
      return null;
    });
    
    await commands.handleActivateCommand(mockMessage, ['lucifer', 'extra', 'words']);
    
    // Verify that we tried the joined version first
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith('lucifer-extra-words');
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('lucifer-extra-words');
    
    // Then verify we tried just the first argument as fallback
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith('lucifer');
    
    // Verify activatePersonality was called with the first arg only
    expect(conversationManager.activatePersonality).toHaveBeenCalledWith(
      mockChannel.id, 'lucifer', mockAuthor.id
    );
    
    // Verify the success message
    expect(mockMessage.reply).toHaveBeenCalled();
    const replyContent = mockMessage.reply.mock.calls[0][0];
    expect(replyContent).toContain('Channel-wide activation');
    expect(replyContent).toContain('Lucifer');
  });
});