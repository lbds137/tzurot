/**
 * Tests for InfoCommand
 */

const {
  createInfoCommand,
} = require('../../../../../src/application/commands/personality/InfoCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');

describe('InfoCommand', () => {
  let command;
  let mockContext;
  let mockPersonalityService;
  let mockFeatureFlags;
  let migrationHelper;

  beforeEach(() => {
    migrationHelper = createMigrationHelper();

    // Create the command
    command = createInfoCommand();

    // Mock personality service
    mockPersonalityService = {
      getPersonality: jest.fn().mockResolvedValue({
        profile: {
          name: 'testpersonality',
          displayName: 'Test Personality',
          avatarUrl: 'https://example.com/avatar.png',
          mode: 'external',
        },
        ownerId: { value: '123456789' },
        aliases: [{ value: 'test' }, { value: 'testy' }],
      }),
      getPersonalityWithProfile: jest.fn().mockResolvedValue({
        profile: {
          name: 'testpersonality',
          displayName: 'Test Personality',
          avatarUrl: 'https://example.com/avatar.png',
          mode: 'external',
        },
        ownerId: { value: '123456789' },
        aliases: [{ value: 'test' }, { value: 'testy' }],
      }),
    };

    // Mock feature flags
    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(false),
    };

    // Mock context
    mockContext = {
      isSlashCommand: false,
      args: ['testpersonality'],
      options: {},
      getUserId: jest.fn().mockReturnValue('123456789'),
      respond: jest.fn().mockResolvedValue(),
      dependencies: {
        personalityApplicationService: mockPersonalityService,
        featureFlags: mockFeatureFlags,
      },
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('command metadata', () => {
    it('should have correct properties', () => {
      expect(command.name).toBe('info');
      expect(command.description).toBe('Display detailed information about a personality');
      expect(command.category).toBe('personality');
      expect(command.aliases).toEqual([]);
      expect(command.permissions).toEqual(['USER']);
    });

    it('should have correct options', () => {
      expect(command.options).toHaveLength(1);
      expect(command.options[0].name).toBe('name');
      expect(command.options[0].type).toBe('string');
      expect(command.options[0].required).toBe(true);
    });
  });

  describe('execute', () => {
    it('should display personality info successfully', async () => {
      await command.execute(mockContext);

      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('testpersonality');

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'Personality Info',
              description: expect.stringContaining('Test Personality'),
              color: 0x2196f3,
              fields: expect.arrayContaining([
                expect.objectContaining({ name: 'Full Name', value: 'testpersonality' }),
                expect.objectContaining({ name: 'Display Name', value: 'Test Personality' }),
                expect.objectContaining({ name: 'Aliases', value: 'test, testy' }),
                expect.objectContaining({ name: 'Created By', value: '<@123456789>' }),
              ]),
              thumbnail: { url: 'https://example.com/avatar.png' },
            }),
          ]),
        })
      );
    });


    it('should handle missing personality name', async () => {
      mockContext.args = [];

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'How to Get Personality Info',
              description: 'View detailed information about a personality.',
              color: 0x2196f3,
            }),
          ]),
        })
      );
      expect(mockPersonalityService.getPersonality).not.toHaveBeenCalled();
    });

    it('should handle slash command format', async () => {
      mockContext.isSlashCommand = true;
      mockContext.options = { name: 'slashpersonality' };

      await command.execute(mockContext);

      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('slashpersonality');
    });

    it('should handle personality not found', async () => {
      mockPersonalityService.getPersonality.mockResolvedValue(null);

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: '❌ Personality Not Found',
              description: expect.stringContaining('No personality found'),
              color: 0xf44336,
            }),
          ]),
        })
      );
    });

    it('should handle personality without aliases', async () => {
      mockPersonalityService.getPersonality.mockResolvedValue({
        profile: {
          name: 'noalias',
          displayName: 'No Alias',
          avatarUrl: null,
        },
        ownerId: { value: '123456789' },
        aliases: [],
      });

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({ name: 'Aliases', value: 'None set' }),
              ]),
            }),
          ]),
        })
      );
    });

    it('should handle personality without display name', async () => {
      mockPersonalityService.getPersonality.mockResolvedValue({
        profile: {
          name: 'nodisplay',
          displayName: null,
          avatarUrl: null,
        },
        ownerId: { value: '123456789' },
        aliases: [{ value: 'nd' }],
      });

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: expect.stringContaining('nodisplay'),
              fields: expect.arrayContaining([
                expect.objectContaining({ name: 'Display Name', value: 'Not set' }),
              ]),
            }),
          ]),
        })
      );
    });

    it('should handle general errors', async () => {
      mockPersonalityService.getPersonality.mockRejectedValue(new Error('Database error'));

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: '❌ Something Went Wrong',
              description: 'An error occurred while getting personality info.',
              color: 0xf44336,
              fields: expect.arrayContaining([
                expect.objectContaining({ name: 'What happened', value: 'Database error' }),
              ]),
            }),
          ]),
        })
      );
    });

    it('should handle missing personality service', async () => {
      mockContext.dependencies.personalityApplicationService = null;

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: '❌ Something Went Wrong',
              description: 'An error occurred while getting personality info.',
              color: 0xf44336,
            }),
          ]),
        })
      );
    });

    it('should support multi-word aliases in text commands', async () => {
      mockContext.args = ['angel', 'dust'];

      await command.execute(mockContext);

      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('angel dust');
    });

    it('should handle multi-word alias with extra spaces', async () => {
      mockContext.args = ['my', 'favorite', 'bot'];

      await command.execute(mockContext);

      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('my favorite bot');
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'Personality Info'
            })
          ])
        })
      );
    });
  });
});
