/**
 * Tests for AliasCommand
 */

const { createAliasCommand } = require('../../../../../src/application/commands/personality/AliasCommand');
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
        success: true,
        personality: {
          profile: {
            name: 'testpersonality',
            displayName: 'Test Personality',
            avatarUrl: 'https://example.com/avatar.png'
          },
          aliases: [{ alias: 'test' }, { alias: 'newalias' }]
        }
      })
    };
    
    // Mock feature flags
    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(false)
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
        botPrefix: '!tz'
      }
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
      
      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith('testpersonality', 'newalias', '123456789');
      
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Alias Added',
          description: 'An alias has been set for **Test Personality**.',
          color: 0x4caf50,
          fields: [
            { name: 'Full Name', value: 'testpersonality', inline: true },
            { name: 'New Alias', value: 'newalias', inline: true }
          ],
          thumbnail: { url: 'https://example.com/avatar.png' }
        })
      );
    });

    it('should add alias successfully without embed support', async () => {
      mockContext.canEmbed.mockReturnValue(false);
      
      await command.execute(mockContext);
      
      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith('testpersonality', 'newalias', '123456789');
      expect(mockContext.respond).toHaveBeenCalledWith(
        '✅ Alias "newalias" has been added to **Test Personality**.'
      );
    });


    it('should handle slash command options', async () => {
      mockContext.isSlashCommand = true;
      mockContext.options = {
        personality: 'testpersonality',
        alias: 'newalias'
      };
      mockContext.args = [];
      
      await command.execute(mockContext);
      
      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith('testpersonality', 'newalias', '123456789');
    });

    it('should require both arguments for text command', async () => {
      mockContext.args = ['testpersonality'];
      
      await command.execute(mockContext);
      
      expect(mockPersonalityService.addAlias).not.toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith(
        'You need to provide a personality name and an alias. Usage: `!tz alias <personality-name> <new-alias>`'
      );
    });

    it('should validate personality name is provided', async () => {
      mockContext.args = ['', 'newalias'];
      
      await command.execute(mockContext);
      
      expect(mockPersonalityService.addAlias).not.toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith('Please provide a personality name or alias.');
    });

    it('should validate alias is provided', async () => {
      mockContext.args = ['testpersonality', ''];
      
      await command.execute(mockContext);
      
      expect(mockPersonalityService.addAlias).not.toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith('Please provide a new alias.');
    });

    it('should validate alias format', async () => {
      mockContext.args = ['testpersonality', 'bad alias!'];
      
      await command.execute(mockContext);
      
      expect(mockPersonalityService.addAlias).not.toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith(
        'Aliases can only contain letters, numbers, underscores, and hyphens.'
      );
    });

    it('should handle service errors', async () => {
      mockPersonalityService.addAlias.mockResolvedValue({
        success: false,
        error: 'Alias already exists'
      });
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith('Alias already exists');
    });

    it('should handle personality without avatar', async () => {
      mockPersonalityService.addAlias.mockResolvedValue({
        success: true,
        personality: {
          profile: {
            name: 'testpersonality',
            displayName: 'Test Personality',
            avatarUrl: null
          }
        }
      });
      
      await command.execute(mockContext);
      
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.not.objectContaining({
          thumbnail: expect.anything()
        })
      );
    });

    it('should handle personality without display name', async () => {
      mockPersonalityService.addAlias.mockResolvedValue({
        success: true,
        personality: {
          profile: {
            name: 'testpersonality',
            displayName: null
          }
        }
      });
      
      await command.execute(mockContext);
      
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'An alias has been set for **testpersonality**.'
        })
      );
    });

    it('should handle missing personality service', async () => {
      mockContext.dependencies.personalityApplicationService = null;
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ An error occurred while adding the alias. ' +
        'Please try again later or contact support if the issue persists.'
      );
    });

    it('should handle service exceptions', async () => {
      mockPersonalityService.addAlias.mockRejectedValue(new Error('Service error'));
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ An error occurred while adding the alias. ' +
        'Please try again later or contact support if the issue persists.'
      );
    });

    it('should lowercase input arguments', async () => {
      mockContext.args = ['TESTPERSONALITY', 'NEWALIAS'];
      
      await command.execute(mockContext);
      
      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith('testpersonality', 'newalias', '123456789');
    });

    it('should use default bot prefix when not provided', async () => {
      mockContext.dependencies.botPrefix = undefined;
      mockContext.args = ['testpersonality'];
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('`!tz alias')
      );
    });

    it('should handle missing user ID', async () => {
      mockContext.getUserId.mockReturnValue(null);
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith('Unable to identify user. Please try again.');
      expect(mockPersonalityService.addAlias).not.toHaveBeenCalled();
    });
  });
});