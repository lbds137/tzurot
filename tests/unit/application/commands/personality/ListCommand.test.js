/**
 * Tests for ListCommand
 */

const { createListCommand } = require('../../../../../src/application/commands/personality/ListCommand');
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
            avatarUrl: 'https://example.com/avatar1.png'
          },
          aliases: [{ alias: 'p1' }, { alias: 'first' }]
        },
        {
          profile: {
            name: 'personality2',
            displayName: 'Second Personality',
            avatarUrl: null
          },
          aliases: []
        },
        {
          profile: {
            name: 'personality3',
            displayName: null,
            avatarUrl: 'https://example.com/avatar3.png'
          },
          aliases: [{ alias: 'p3' }]
        }
      ])
    };
    
    // Mock feature flags
    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(false)
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
        botPrefix: '!tz'
      }
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
      
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Your Personalities (Page 1/1)',
          description: 'You have added 3 personalities.',
          color: 0x00bcd4,
          fields: [
            {
              name: '1. First Personality',
              value: 'Name: `personality1`\nAliases: p1, first',
              inline: false
            },
            {
              name: '2. Second Personality',
              value: 'Name: `personality2`\nAliases: None',
              inline: false
            },
            {
              name: '3. personality3',
              value: 'Name: `personality3`\nAliases: p3',
              inline: false
            }
          ],
          footer: {
            text: 'Page 1 of 1',
            icon_url: 'https://example.com/user.png'
          },
          author: {
            name: 'TestUser',
            icon_url: 'https://example.com/user.png'
          }
        })
      );
    });

    it('should list personalities successfully without embed support', async () => {
      mockContext.canEmbed.mockReturnValue(false);
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        '**Your Personalities (Page 1/1)**\n' +
        'You have added 3 personalities.\n\n' +
        '**1. First Personality**\n' +
        '   Name: `personality1`\n' +
        '   Aliases: p1, first\n\n' +
        '**2. Second Personality**\n' +
        '   Name: `personality2`\n' +
        '   Aliases: None\n\n' +
        '**3. personality3**\n' +
        '   Name: `personality3`\n' +
        '   Aliases: p3\n\n'
      );
    });

    it('should handle pagination', async () => {
      // Create 15 personalities for pagination test
      const manyPersonalities = Array.from({ length: 15 }, (_, i) => ({
        profile: {
          name: `personality${i + 1}`,
          displayName: `Personality ${i + 1}`
        },
        aliases: []
      }));
      mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue(manyPersonalities);
      
      mockContext.args = ['2'];
      
      await command.execute(mockContext);
      
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Your Personalities (Page 2/2)',
          description: expect.stringContaining('You have added 15 personalities.'),
          fields: expect.arrayContaining([
            expect.objectContaining({ name: '11. Personality 11' }),
            expect.objectContaining({ name: '12. Personality 12' }),
            expect.objectContaining({ name: '13. Personality 13' }),
            expect.objectContaining({ name: '14. Personality 14' }),
            expect.objectContaining({ name: '15. Personality 15' })
          ]),
          footer: expect.objectContaining({ text: 'Page 2 of 2' })
        })
      );
    });

    it('should handle slash command options', async () => {
      mockContext.isSlashCommand = true;
      mockContext.options = { page: 1 };
      
      await command.execute(mockContext);
      
      expect(mockPersonalityService.listPersonalitiesByOwner).toHaveBeenCalledWith('123456789');
    });

    it('should handle no personalities', async () => {
      mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue([]);
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        "You haven't added any personalities yet. Use `!tz add <personality-name>` to add one."
      );
    });

    it('should handle invalid page number', async () => {
      mockContext.args = ['5'];
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        'Invalid page number. Please specify a page between 1 and 1.'
      );
    });

    it('should handle non-numeric page argument', async () => {
      mockContext.args = ['abc'];
      
      await command.execute(mockContext);
      
      // Should default to page 1
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Your Personalities (Page 1/1)'
        })
      );
    });

    it('should show pagination hint for multiple pages', async () => {
      // Create 15 personalities for pagination test
      const manyPersonalities = Array.from({ length: 15 }, (_, i) => ({
        profile: { name: `personality${i + 1}` },
        aliases: []
      }));
      mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue(manyPersonalities);
      
      await command.execute(mockContext);
      
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('Use `!tz list <page>` to view other pages.')
        })
      );
    });

    it('should handle missing personality service', async () => {
      mockContext.dependencies.personalityApplicationService = null;
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ An error occurred while listing personalities. ' +
        'Please try again later or contact support if the issue persists.'
      );
    });

    it('should handle service exceptions', async () => {
      mockPersonalityService.listPersonalitiesByOwner.mockRejectedValue(new Error('Service error'));
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        '❌ An error occurred while listing personalities. ' +
        'Please try again later or contact support if the issue persists.'
      );
    });

    it('should handle single personality correctly', async () => {
      mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue([
        {
          profile: { name: 'lonelypersonality' },
          aliases: []
        }
      ]);
      
      await command.execute(mockContext);
      
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'You have added 1 personality.'
        })
      );
    });

    it('should use default bot prefix when not provided', async () => {
      mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue([]);
      mockContext.dependencies.botPrefix = undefined;
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('`!tz add')
      );
    });

    it('should handle null page in slash command', async () => {
      mockContext.isSlashCommand = true;
      mockContext.options = { page: null };
      
      await command.execute(mockContext);
      
      // Should default to page 1
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Your Personalities (Page 1/1)'
        })
      );
    });

    it('should parse page number as integer', async () => {
      mockContext.args = ['1.5'];
      
      await command.execute(mockContext);
      
      // Should parse to 1
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Your Personalities (Page 1/1)'
        })
      );
    });
  });
});