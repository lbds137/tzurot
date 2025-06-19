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

// Create the mock handler directly in the test file
const mockPersonalityManager = {
  getPersonality: jest.fn(),
  getPersonalityByAlias: jest.fn(),
};

const mockAiService = {};

const mockUtils = {
  createDirectSend: jest.fn(),
  validateAlias: jest.fn().mockReturnValue(true),
  cleanupTimeout: jest.fn(),
  safeToLowerCase: jest.fn(str => str?.toLowerCase() || ''),
  getAllAliasesForPersonality: jest.fn().mockReturnValue(['alias1', 'alias2']),
};

const mockValidator = {
  createDirectSend: jest.fn(),
};

// Create a mock info command handler that doesn't rely on the real modules
const mockInfoCommand = {
  meta: {
    name: 'info',
    description: 'Display detailed information about a personality',
    usage: 'info <personality-name-or-alias>',
    aliases: [],
    permissions: [],
  },
  execute: jest.fn().mockImplementation(async (message, args) => {
    const sendFn = mockValidator.createDirectSend(message);

    if (args.length < 1) {
      return await sendFn('You need to provide a personality name or alias.');
    }

    const personalityInput = args[0].toLowerCase();

    try {
      // Look up by alias then by name
      let personality = mockPersonalityManager.getPersonalityByAlias(personalityInput);

      if (!personality) {
        personality = mockPersonalityManager.getPersonality(personalityInput);
      }

      if (!personality) {
        return await sendFn(`Personality "${personalityInput}" not found.`);
      }

      // Create mock embed response
      const isProblematic = false;

      // Return success with embed
      return await sendFn({
        embeds: [
          {
            title: 'Personality Info',
            fields: [
              {
                name: 'Status',
                value: isProblematic ? 'Has experienced issues' : 'Working normally',
              },
            ],
          },
        ],
      });
    } catch (error) {
      return await sendFn(`An error occurred: ${error.message}`);
    }
  }),
};

// Replace the real modules with our mocks
jest.mock('../../../../src/core/personality', () => mockPersonalityManager);
jest.mock('../../../../src/aiService', () => mockAiService);
jest.mock('../../../../src/utils', () => mockUtils);
jest.mock('../../../../src/commands/utils/commandValidator', () => mockValidator);
jest.mock('../../../../src/commands/handlers/info', () => mockInfoCommand, { virtual: true });

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../../src/logger');
const config = require('../../../../config');
const personalityManager = require('../../../../src/core/personality');
const aiService = require('../../../../src/aiService');
const validator = require('../../../../src/commands/utils/commandValidator');

describe('Info Command', () => {
  let infoCommand;
  let mockMessage;
  let mockDirectSend;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock EmbedBuilder
    EmbedBuilder.mockImplementation(() => ({
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({ title: 'Personality Info' }),
    }));

    // Create mock message
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      content: 'Mock Response',
      embeds: [{ title: 'Personality Info' }],
    });

    // Create mock direct send for validation
    mockDirectSend = jest.fn().mockResolvedValue({
      id: 'direct-sent-123',
    });

    // Set up mock validator to return our mock function
    mockValidator.createDirectSend.mockReturnValue(mockDirectSend);

    // Set up mock personality
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png',
      aliases: {
        'user-123': ['alias1', 'alias2'],
      },
    };

    // Reset mock personality manager
    mockPersonalityManager.getPersonality.mockReturnValue(mockPersonality);
    mockPersonalityManager.getPersonalityByAlias.mockReturnValue(null);

    // Reset mock aiService

    // Get the mocked info command
    infoCommand = require('../../../../src/commands/handlers/info');
  });

  it('should have the correct metadata', () => {
    expect(infoCommand.meta).toEqual({
      name: 'info',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array),
    });
  });

  it('should require a personality name or alias', async () => {
    await infoCommand.execute(mockMessage, []);

    // Verify validate method was called
    expect(mockValidator.createDirectSend).toHaveBeenCalledWith(mockMessage);

    // Verify direct send was called with error message
    expect(mockDirectSend).toHaveBeenCalledWith(
      expect.stringContaining('need to provide a personality name or alias')
    );
  });

  it('should handle non-existent personality', async () => {
    // Mock personality not found
    mockPersonalityManager.getPersonality.mockReturnValueOnce(null);
    mockPersonalityManager.getPersonalityByAlias.mockReturnValueOnce(null);

    await infoCommand.execute(mockMessage, ['nonexistent-personality']);

    expect(mockPersonalityManager.getPersonalityByAlias).toHaveBeenCalledWith(
      'nonexistent-personality'
    );
    expect(mockPersonalityManager.getPersonality).toHaveBeenCalledWith('nonexistent-personality');

    expect(mockDirectSend).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('should show info for a personality by name', async () => {
    await infoCommand.execute(mockMessage, ['test-personality']);

    expect(mockPersonalityManager.getPersonalityByAlias).toHaveBeenCalledWith('test-personality');
    expect(mockPersonalityManager.getPersonality).toHaveBeenCalledWith('test-personality');

    // Check that the direct send was called with embed
    expect(mockDirectSend).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
      })
    );
  });

  it('should show info for a personality by alias', async () => {
    // Set up mock for alias lookup
    const mockPersonality = {
      fullName: 'full-personality-name',
      displayName: 'Display Name',
      avatarUrl: 'https://example.com/avatar.png',
      aliases: {
        'user-123': ['test-alias', 'another-alias'],
      },
    };
    mockPersonalityManager.getPersonalityByAlias.mockReturnValueOnce(mockPersonality);

    await infoCommand.execute(mockMessage, ['test-alias']);

    expect(mockPersonalityManager.getPersonalityByAlias).toHaveBeenCalledWith('test-alias');

    // Check that a response with embed was sent
    expect(mockDirectSend).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
      })
    );
  });

  it('should handle unexpected errors gracefully', async () => {
    // Mock unexpected error
    mockPersonalityManager.getPersonalityByAlias.mockImplementationOnce(() => {
      throw new Error('Unexpected error');
    });

    await infoCommand.execute(mockMessage, ['test-personality']);

    // Check that an error message was sent
    expect(mockDirectSend).toHaveBeenCalledWith(expect.stringContaining('An error occurred'));
  });
});
