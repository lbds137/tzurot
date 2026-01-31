/**
 * Tests for ListCommand
 */

const {
  createListCommand,
} = require('../../../../../src/application/commands/personality/ListCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');

describe('ListCommand', () => {
  let command;
  let mockContext;
  let mockPersonalityService;
  let mockFeatureFlags;
  let migrationHelper;

  beforeEach(() => {
    migrationHelper = createMigrationHelper();

    // Create the command
    command = createListCommand();

    // Mock personality service
    mockPersonalityService = {
      listPersonalitiesByOwner: jest.fn().mockResolvedValue([
        {
          profile: {
            name: 'personality1',
            displayName: 'First Personality',
            avatarUrl: 'https://example.com/avatar1.png',
          },
          aliases: [{ alias: 'p1' }, { alias: 'first' }],
        },
        {
          profile: {
            name: 'personality2',
            displayName: 'Second Personality',
            avatarUrl: null,
          },
          aliases: [],
        },
        {
          profile: {
            name: 'personality3',
            displayName: null,
            avatarUrl: 'https://example.com/avatar3.png',
          },
          aliases: [{ alias: 'p3' }],
        },
      ]),
    };

    // Mock feature flags
    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(false),
    };

    // Mock context
    mockContext = {
      isSlashCommand: false,
      args: [],
      options: {},
      getUserId: jest.fn().mockReturnValue('123456789'),
      getAuthorDisplayName: jest.fn().mockReturnValue('TestUser'),
      getAuthorAvatarUrl: jest.fn().mockReturnValue('https://example.com/user.png'),
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
      expect(command.name).toBe('list');
      expect(command.description).toBe("List all AI personalities you've added");
      expect(command.category).toBe('personality');
      expect(command.aliases).toEqual([]);
      expect(command.permissions).toEqual(['USER']);
    });

    it('should have correct options', () => {
      expect(command.options).toHaveLength(1);
      expect(command.options[0].name).toBe('page');
      expect(command.options[0].type).toBe('integer');
      expect(command.options[0].required).toBe(false);
    });
  });

  describe('execute', () => {
    it('should list personalities successfully with embed', async () => {
      await command.execute(mockContext);

      expect(mockPersonalityService.listPersonalitiesByOwner).toHaveBeenCalledWith('123456789');

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '📋 Your Personalities',
            description: 'Showing 3 of 3 personalities',
            color: 0x2196f3,
            fields: expect.arrayContaining([
              {
                name: '1. First Personality',
                value: '**Name:** `personality1`\n**Aliases:** p1, first',
                inline: false,
              },
              {
                name: '2. Second Personality',
                value: '**Name:** `personality2`\n**Aliases:** None',
                inline: false,
              },
              {
                name: '3. personality3',
                value: '**Name:** `personality3`\n**Aliases:** p3',
                inline: false,
              },
            ]),
            footer: {
              text: 'Page 1 of 1',
            },
          }),
        ],
      });
    });

    it('should list personalities successfully without embed support', async () => {
      mockContext.canEmbed.mockReturnValue(false);

      await command.execute(mockContext);

      expect(mockPersonalityService.listPersonalitiesByOwner).toHaveBeenCalledWith('123456789');
      expect(mockContext.respond).toHaveBeenCalled();
    });

    it('should handle pagination', async () => {
      // Create 15 personalities for pagination test
      const personalities = [];
      for (let i = 1; i <= 15; i++) {
        personalities.push({
          profile: {
            name: `personality${i}`,
            displayName: `Personality ${i}`,
            avatarUrl: null,
          },
          aliases: [],
        });
      }
      mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue(personalities);

      mockContext.args = ['2']; // Page 2

      await command.execute(mockContext);

      const embedCall = mockContext.respond.mock.calls[0][0];
      expect(embedCall.embeds[0].title).toBe('📋 Your Personalities');
      expect(embedCall.embeds[0].description).toBe('Showing 5 of 15 personalities');
      expect(embedCall.embeds[0].footer.text).toBe('Page 2 of 2');
      expect(embedCall.embeds[0].fields[0].name).toBe('11. Personality 11');
    });

    it('should handle slash command options', async () => {
      mockContext.isSlashCommand = true;
      mockContext.options = { page: 1 };

      await command.execute(mockContext);

      expect(mockPersonalityService.listPersonalitiesByOwner).toHaveBeenCalledWith('123456789');
      expect(mockContext.respond).toHaveBeenCalled();
    });

    it('should handle no personalities', async () => {
      mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue([]);

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '📋 No Personalities Yet',
            description: "You haven't added any personalities.",
            color: 0xff9800,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Get Started',
                value: expect.stringContaining('!tz add <personality-name>'),
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle invalid page number', async () => {
      mockContext.args = ['5']; // Page 5 doesn't exist

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Invalid Page Number',
            description: 'The page number you specified is out of range.',
            color: 0xf44336,
            fields: expect.arrayContaining([
              {
                name: 'Valid Range',
                value: 'Pages 1 to 1',
                inline: true,
              },
              {
                name: 'You Entered',
                value: '5',
                inline: true,
              },
            ]),
          }),
        ],
      });
    });

    it('should handle non-numeric page argument', async () => {
      mockContext.args = ['abc'];

      await command.execute(mockContext);

      // Should default to page 1
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '📋 Your Personalities',
            footer: {
              text: 'Page 1 of 1',
            },
          }),
        ],
      });
    });

    it('should show pagination hint for multiple pages', async () => {
      // Create 15 personalities for pagination test
      const personalities = [];
      for (let i = 1; i <= 15; i++) {
        personalities.push({
          profile: {
            name: `personality${i}`,
            displayName: `Personality ${i}`,
            avatarUrl: null,
          },
          aliases: [],
        });
      }
      mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue(personalities);

      await command.execute(mockContext);

      const embedCall = mockContext.respond.mock.calls[0][0];
      const fields = embedCall.embeds[0].fields;
      const navigationField = fields.find(f => f.name === 'Navigation');
      expect(navigationField).toBeDefined();
      expect(navigationField.value).toContain('!tz list <page>');
    });

    it('should handle missing personality service', async () => {
      mockContext.dependencies.personalityApplicationService = null;

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Something Went Wrong',
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'What happened',
                value: 'PersonalityApplicationService not available',
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle service exceptions', async () => {
      mockPersonalityService.listPersonalitiesByOwner.mockRejectedValue(new Error('Service error'));

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Something Went Wrong',
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'What happened',
                value: 'Service error',
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle single personality correctly', async () => {
      mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue([
        {
          profile: {
            name: 'single-personality',
            displayName: 'Single One',
            avatarUrl: null,
          },
          aliases: [],
        },
      ]);

      await command.execute(mockContext);

      const embedCall = mockContext.respond.mock.calls[0][0];
      expect(embedCall.embeds[0].description).toBe('Showing 1 of 1 personalities');
      expect(embedCall.embeds[0].footer.text).toBe('Page 1 of 1');
      // Should not show navigation field for single page
      const navigationField = embedCall.embeds[0].fields.find(f => f.name === 'Navigation');
      expect(navigationField).toBeUndefined();
    });

    it('should use default bot prefix when not provided', async () => {
      mockContext.dependencies.botPrefix = undefined;
      mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue([]);

      await command.execute(mockContext);

      const embedCall = mockContext.respond.mock.calls[0][0];
      expect(embedCall.embeds[0].fields[0].value).toContain('!tz add');
    });

    it('should handle null page in slash command', async () => {
      mockContext.isSlashCommand = true;
      mockContext.options = { page: null };

      await command.execute(mockContext);

      // Should default to page 1
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            footer: {
              text: 'Page 1 of 1',
            },
          }),
        ],
      });
    });

    it('should parse page number as integer', async () => {
      mockContext.args = ['1.5']; // Decimal number

      await command.execute(mockContext);

      // Should parse as 1
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            footer: {
              text: 'Page 1 of 1',
            },
          }),
        ],
      });
    });


    it('should handle aliases as objects with value property', async () => {
      mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue([
        {
          profile: {
            name: 'personality1',
            displayName: 'First Personality',
            avatarUrl: 'https://example.com/avatar1.png',
          },
          aliases: [{ value: 'p1' }, { value: 'first' }],
        },
      ]);

      await command.execute(mockContext);

      const embedCall = mockContext.respond.mock.calls[0][0];
      expect(embedCall.embeds[0].fields[0].value).toBe(
        '**Name:** `personality1`\n**Aliases:** p1, first'
      );
    });
  });
});
