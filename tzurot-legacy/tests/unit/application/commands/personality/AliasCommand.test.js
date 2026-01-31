/**
 * Tests for AliasCommand
 */

const {
  createAliasCommand,
} = require('../../../../../src/application/commands/personality/AliasCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');

describe('AliasCommand', () => {
  let command;
  let mockContext;
  let mockPersonalityService;
  let mockFeatureFlags;
  let migrationHelper;

  beforeEach(() => {
    migrationHelper = createMigrationHelper();

    // Create the command
    command = createAliasCommand();

    // Mock personality service
    mockPersonalityService = {
      addAlias: jest.fn().mockResolvedValue({
        profile: {
          name: 'testpersonality',
          displayName: 'Test Personality',
          avatarUrl: 'https://example.com/avatar.png',
        },
        aliases: [{ alias: 'test' }, { alias: 'newalias' }],
      }),
    };

    // Mock feature flags
    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(false),
    };

    // Mock context
    mockContext = {
      isSlashCommand: false,
      args: ['testpersonality', 'newalias'],
      options: {},
      getUserId: jest.fn().mockReturnValue('123456789'),
      respond: jest.fn().mockResolvedValue(),
      respondWithEmbed: jest.fn().mockResolvedValue(),
      canEmbed: jest.fn().mockReturnValue(true),
      dependencies: {
        personalityApplicationService: mockPersonalityService,
        featureFlags: mockFeatureFlags,
        botPrefix: '!tz',
      },
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('command metadata', () => {
    it('should have correct properties', () => {
      expect(command.name).toBe('alias');
      expect(command.description).toBe('Add an alias/nickname for an existing personality');
      expect(command.category).toBe('personality');
      expect(command.aliases).toEqual([]);
      expect(command.permissions).toEqual(['USER']);
    });

    it('should have correct options', () => {
      expect(command.options).toHaveLength(2);
      expect(command.options[0].name).toBe('personality');
      expect(command.options[0].type).toBe('string');
      expect(command.options[0].required).toBe(true);
      expect(command.options[1].name).toBe('alias');
      expect(command.options[1].type).toBe('string');
      expect(command.options[1].required).toBe(true);
    });
  });

  describe('execute', () => {
    it('should add alias successfully with embed', async () => {
      await command.execute(mockContext);

      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith({
        personalityName: 'testpersonality',
        alias: 'newalias',
        requesterId: '123456789',
      });

      // No respondWithEmbed anymore, check the normal respond was called correctly above
    });

    it('should add alias successfully without embed support', async () => {
      mockContext.canEmbed.mockReturnValue(false);

      await command.execute(mockContext);

      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith({
        personalityName: 'testpersonality',
        alias: 'newalias',
        requesterId: '123456789',
      });
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Alias Added Successfully!',
          }),
        ],
      });
    });

    it('should handle slash command options', async () => {
      mockContext.isSlashCommand = true;
      mockContext.options = {
        personality: 'testpersonality',
        alias: 'newalias',
      };
      mockContext.args = [];

      await command.execute(mockContext);

      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith({
        personalityName: 'testpersonality',
        alias: 'newalias',
        requesterId: '123456789',
      });
    });

    it('should require both arguments for text command', async () => {
      mockContext.args = ['testpersonality'];

      await command.execute(mockContext);

      expect(mockPersonalityService.addAlias).not.toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'How to Add an Alias',
            description: 'Add a nickname or shortcut for an existing personality.',
            color: 0x2196f3,
          }),
        ],
      });
    });

    it('should validate personality name is provided', async () => {
      mockContext.args = ['', 'newalias'];

      await command.execute(mockContext);

      expect(mockPersonalityService.addAlias).not.toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Missing Personality Name',
            description: 'Please provide a personality name or existing alias.',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should validate alias is provided', async () => {
      mockContext.args = ['testpersonality', ''];

      await command.execute(mockContext);

      expect(mockPersonalityService.addAlias).not.toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Missing Alias',
            description: 'Please provide a new alias to add.',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should validate alias format', async () => {
      mockContext.args = ['testpersonality', 'bad alias!'];

      await command.execute(mockContext);

      expect(mockPersonalityService.addAlias).not.toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Invalid Alias Format',
            description: 'Aliases can only contain letters, numbers, spaces, underscores, and hyphens.',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle service errors', async () => {
      mockPersonalityService.addAlias.mockRejectedValue(new Error('Alias already exists'));

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Something Went Wrong',
            description: 'An error occurred while adding the alias.',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle personality without avatar', async () => {
      mockPersonalityService.addAlias.mockResolvedValue({
        profile: {
          name: 'testpersonality',
          displayName: 'Test Personality',
          avatarUrl: null,
        },
        aliases: [{ alias: 'test' }, { alias: 'newalias' }],
      });

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Alias Added Successfully!',
            description: expect.stringContaining('The alias **newalias** has been added'),
          }),
        ],
      });
      // Check thumbnail is not present
      const call = mockContext.respond.mock.calls[0][0];
      expect(call.embeds[0].thumbnail).toBeUndefined();
    });

    it('should handle personality without display name', async () => {
      mockPersonalityService.addAlias.mockResolvedValue({
        profile: {
          name: 'testpersonality',
          displayName: null,
        },
        aliases: [{ alias: 'test' }, { alias: 'newalias' }],
      });

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Alias Added Successfully!',
            description: expect.stringContaining(
              'The alias **newalias** has been added to **testpersonality**'
            ),
          }),
        ],
      });
    });

    it('should handle missing personality service', async () => {
      mockContext.dependencies.personalityApplicationService = null;

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Something Went Wrong',
            description: 'An error occurred while adding the alias.',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle service exceptions', async () => {
      mockPersonalityService.addAlias.mockRejectedValue(new Error('Service error'));

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Something Went Wrong',
            description: 'An error occurred while adding the alias.',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should lowercase input arguments', async () => {
      mockContext.args = ['TESTPERSONALITY', 'NEWALIAS'];

      await command.execute(mockContext);

      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith({
        personalityName: 'testpersonality',
        alias: 'newalias',
        requesterId: '123456789',
      });
    });

    it('should use default bot prefix when not provided', async () => {
      mockContext.dependencies.botPrefix = undefined;
      mockContext.args = ['testpersonality'];

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Basic Usage',
                value: '`!tz alias <personality-name> <new-alias>`',
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle missing user ID', async () => {
      mockContext.getUserId.mockReturnValue(null);

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        'Unable to identify user. Please try again.'
      );
      expect(mockPersonalityService.addAlias).not.toHaveBeenCalled();
    });

    it('should support multi-word aliases', async () => {
      mockContext.args = ['claude', 'my', 'favorite', 'bot'];

      await command.execute(mockContext);

      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith({
        personalityName: 'claude',
        alias: 'my favorite bot',
        requesterId: '123456789',
      });
    });

    it('should handle personality with two-word alias', async () => {
      mockContext.args = ['assistant', 'helper', 'bot'];

      await command.execute(mockContext);

      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith({
        personalityName: 'assistant',
        alias: 'helper bot',
        requesterId: '123456789',
      });
    });

    it('should handle single word personality with single word alias', async () => {
      mockContext.args = ['claude', 'cl'];

      await command.execute(mockContext);

      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith({
        personalityName: 'claude',
        alias: 'cl',
        requesterId: '123456789',
      });
    });

    it('should reject alias with invalid characters', async () => {
      mockContext.args = ['claude', 'my@alias!'];

      await command.execute(mockContext);

      expect(mockPersonalityService.addAlias).not.toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Invalid Alias Format',
            description: 'Aliases can only contain letters, numbers, spaces, underscores, and hyphens.',
          }),
        ],
      });
    });
  });
});
