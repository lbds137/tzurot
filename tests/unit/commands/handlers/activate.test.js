// Mock dependencies
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@',
  },
}));

// Import the test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import and mock command dependencies
const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const logger = require('../../../../src/logger');

describe('Activate Command Handler', () => {
  // Setup module mocks before requiring the module
  let mockMessage;
  let mockDirectSend;
  let personalityManager;
  let conversationManager;
  let channelUtils;
  let validator;
  let activateCommand;

  beforeEach(() => {
    // Reset modules between tests
    jest.resetModules();
    jest.clearAllMocks();

    // Setup mocks
    jest.doMock('../../../../src/core/personality', () => ({
      getPersonality: jest.fn(),
      getPersonalityByAlias: jest.fn(),
    }));

    jest.doMock('../../../../src/core/conversation', () => ({
      activatePersonality: jest.fn(),
    }));

    jest.doMock('../../../../src/utils/channelUtils', () => ({
      isChannelNSFW: jest.fn(),
    }));

    jest.doMock('../../../../src/commands/utils/commandValidator', () => {
      return {
        createDirectSend: jest.fn(),
        canManageMessages: jest.fn(),
      };
    });

    jest.doMock('../../../../src/utils', () => ({
      createDirectSend: jest.fn().mockImplementation(message => {
        return async content => {
          return message.channel.send(content);
        };
      }),
    }));

    // Create mock message
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{ title: 'Personality Activated' }],
    });

    // Setup validator mock
    mockDirectSend = jest.fn().mockImplementation(content => {
      return mockMessage.channel.send(content);
    });

    // Mock EmbedBuilder
    EmbedBuilder.mockImplementation(() => ({
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
    }));

    // Import modules after mocking
    personalityManager = require('../../../../src/core/personality');
    conversationManager = require('../../../../src/core/conversation');
    channelUtils = require('../../../../src/utils/channelUtils');
    validator = require('../../../../src/commands/utils/commandValidator');

    // Setup validator's createDirectSend mock
    validator.createDirectSend.mockReturnValue(mockDirectSend);

    // Setup default mock behaviors
    validator.canManageMessages.mockReturnValue(true);
    channelUtils.isChannelNSFW.mockReturnValue(true);
    conversationManager.activatePersonality.mockReturnValue({ success: true });

    // Basic personality for testing
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png',
      description: 'Test description',
      createdBy: 'user-123',
      createdAt: Date.now(),
    };

    // Multi-word personality for testing
    const mockMultiWordPersonality = {
      fullName: 'lucifer-seraph-ha-lev-nafal',
      displayName: 'Lucifer',
      avatarUrl: 'https://example.com/lucifer.png',
      description: 'Fallen angel personality',
      createdBy: 'user-123',
      createdAt: Date.now(),
    };

    // Mock personalityManager functions
    personalityManager.getPersonality.mockImplementation(name => {
      if (name === 'test-personality') return mockPersonality;
      if (name === 'lucifer seraph ha lev nafal') return mockMultiWordPersonality;
      return null;
    });

    personalityManager.getPersonalityByAlias.mockImplementation(alias => {
      if (alias === 'test') return mockPersonality;
      if (alias === 'lucifer') return mockMultiWordPersonality;
      return null;
    });

    // Import the command module after mocks are set up
    activateCommand = require('../../../../src/commands/handlers/activate');
  });

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('should have the correct metadata', () => {
    expect(activateCommand.meta).toEqual({
      name: 'activate',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array),
    });
  });

  test('should activate a personality with a simple name', async () => {
    // Mock the EmbedBuilder to return a fixed object
    const mockEmbed = {
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
    };
    EmbedBuilder.mockReturnValue(mockEmbed);

    await activateCommand.execute(mockMessage, ['test-personality']);

    // Expect it to check for the personality
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith('test-personality');
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
    expect(conversationManager.activatePersonality).toHaveBeenCalledWith(
      mockMessage.channel.id,
      'test-personality',
      'user-123'
    );

    // Verify that channel.send was called (but not checking the exact content)
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });

  test('should activate a personality by alias', async () => {
    // Mock the EmbedBuilder to return a fixed object
    const mockEmbed = {
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
    };
    EmbedBuilder.mockReturnValue(mockEmbed);

    await activateCommand.execute(mockMessage, ['test']);

    // Check alias lookup
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith('test');
    expect(conversationManager.activatePersonality).toHaveBeenCalledWith(
      mockMessage.channel.id,
      'test-personality',
      'user-123'
    );

    // Verify that channel.send was called
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });

  test('should activate a personality with a multi-word name', async () => {
    // Mock the EmbedBuilder to return a fixed object
    const mockEmbed = {
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
    };
    EmbedBuilder.mockReturnValue(mockEmbed);

    await activateCommand.execute(mockMessage, ['lucifer', 'seraph', 'ha', 'lev', 'nafal']);

    // Check that it used the joined string
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      'lucifer seraph ha lev nafal'
    );
    expect(conversationManager.activatePersonality).toHaveBeenCalledWith(
      mockMessage.channel.id,
      'lucifer-seraph-ha-lev-nafal',
      'user-123'
    );

    // Verify that channel.send was called
    expect(mockMessage.channel.send).toHaveBeenCalled();
  });

  test('should handle the case where the user has insufficient permissions', async () => {
    // Override permissions mock to return false for ManageMessages
    validator.canManageMessages.mockReturnValueOnce(false);

    await activateCommand.execute(mockMessage, ['test-personality']);

    // Verify that activatePersonality was not called
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();

    // Verify the error message
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringMatching(/need the "Manage Messages" permission/)
    );
  });

  test('should handle the case where no personality name is provided', async () => {
    await activateCommand.execute(mockMessage, []);

    // Verify that activatePersonality was not called
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();

    // Verify the error message
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringMatching(/You need to provide a personality name or alias/)
    );
  });

  test('should handle the case where the personality is not found', async () => {
    // Reset mocks for this specific test
    jest.clearAllMocks();

    // Ensure all personality lookups return null
    personalityManager.getPersonalityByAlias.mockReturnValue(null);
    personalityManager.getPersonality.mockReturnValue(null);

    await activateCommand.execute(mockMessage, ['nonexistent-personality']);

    // Verify that we tried to lookup the personality
    expect(personalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      'nonexistent-personality'
    );
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('nonexistent-personality');

    // Verify that activatePersonality was not called
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();

    // Verify the error message
    expect(mockMessage.channel.send).toHaveBeenCalledWith(expect.stringMatching(/not found/));
  });

  test('should not allow activation in DM channels', async () => {
    // Create DM mock message
    const dmMockMessage = helpers.createMockMessage({ isDM: true });
    dmMockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      content: 'Error message',
    });

    // Create a custom directSend for the DM channel
    const dmDirectSend = jest.fn().mockImplementation(content => {
      return dmMockMessage.channel.send(content);
    });

    // Override the validator mock for this test
    validator.createDirectSend.mockImplementation(message => {
      if (message === dmMockMessage) {
        return dmDirectSend;
      }
      return mockDirectSend;
    });

    await activateCommand.execute(dmMockMessage, ['test-personality']);

    // Verify that activatePersonality was not called
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();

    // Verify the error message
    expect(dmMockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringMatching(/Channel activation is not needed in DMs/)
    );
  });

  test('should not allow activation in non-NSFW channels', async () => {
    // Make the channel appear as non-NSFW
    channelUtils.isChannelNSFW.mockReturnValueOnce(false);

    await activateCommand.execute(mockMessage, ['test-personality']);

    // Verify that activatePersonality was not called
    expect(conversationManager.activatePersonality).not.toHaveBeenCalled();

    // Verify the error message
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringMatching(/can only be activated in channels marked as NSFW/)
    );
  });

  test('should handle activation errors properly', async () => {
    // Set up an error in personality lookup (not in activation itself)
    personalityManager.getPersonality.mockReturnValueOnce(null);

    await activateCommand.execute(mockMessage, ['nonexistent-personality']);

    // Verify the error message
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      'Personality "nonexistent-personality" not found. Please check the name or alias and try again.'
    );
  });
});
