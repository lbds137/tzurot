/**
 * Tests for RemoveCommand
 */

const { createRemoveCommand } = require('../../../../../src/application/commands/personality/RemoveCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');

describe('RemoveCommand', () => {
  let command;
  let mockContext;
  let mockPersonalityService;
  let mockFeatureFlags;
  let mockProfileInfoCache;
  let mockMessageTracker;
  let migrationHelper;

  beforeEach(() => {
    migrationHelper = createMigrationHelper();
    
    // Create the command
    command = createRemoveCommand();
    
    // Mock personality service
    mockPersonalityService = {
      getPersonality: jest.fn().mockResolvedValue({
        profile: {
          name: 'testpersonality',
          displayName: 'Test Personality'
        }
      }),
      removePersonality: jest.fn().mockResolvedValue(undefined)
    };
    
    // Mock profile info cache
    mockProfileInfoCache = {
      deleteFromCache: jest.fn()
    };
    
    // Mock message tracker
    mockMessageTracker = {
      removeCompletedAddCommand: jest.fn()
    };
    
    // Mock feature flags
    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(false)
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
        profileInfoCache: mockProfileInfoCache,
        messageTracker: mockMessageTracker,
        botPrefix: '!tz'
      }
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('command metadata', () => {
    it('should have correct properties', () => {
      expect(command.name).toBe('remove');
      expect(command.description).toBe('Remove a personality from your collection');
      expect(command.category).toBe('personality');
      expect(command.aliases).toEqual(['delete']);
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
    it('should remove personality successfully', async () => {
      await command.execute(mockContext);
      
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('testpersonality');
      expect(mockPersonalityService.removePersonality).toHaveBeenCalledWith({
        personalityName: 'testpersonality',
        requesterId: '123456789'
      });
      
      expect(mockProfileInfoCache.deleteFromCache).toHaveBeenCalledWith('testpersonality');
      expect(mockMessageTracker.removeCompletedAddCommand).toHaveBeenCalledWith('123456789', 'testpersonality');
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('✅ **Test Personality** has been removed'),
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'Personality Removed',
              color: 0xf44336
            })
          ])
        })
      );
    });

    it('should show new system indicator when feature flag enabled', async () => {
      mockFeatureFlags.isEnabled.mockReturnValue(true);
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Using new DDD system')
        })
      );
    });

    it('should handle missing personality name', async () => {
      mockContext.args = [];
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('You need to provide a personality name')
      );
      expect(mockPersonalityService.removePersonality).not.toHaveBeenCalled();
    });

    it('should handle slash command format', async () => {
      mockContext.isSlashCommand = true;
      mockContext.options = { name: 'SlashPersonality' }; // Test case normalization
      
      await command.execute(mockContext);
      
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('slashpersonality'); // Should be normalized
      expect(mockPersonalityService.removePersonality).toHaveBeenCalledWith({
        personalityName: 'testpersonality',
        requesterId: '123456789'
      });
    });

    it('should handle personality not found error', async () => {
      mockPersonalityService.getPersonality.mockResolvedValue(null);
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      );
      expect(mockPersonalityService.removePersonality).not.toHaveBeenCalled();
    });

    it('should handle permission error', async () => {
      mockPersonalityService.removePersonality.mockRejectedValue(
        new Error('Only the owner can remove a personality')
      );
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('cannot remove a personality that you didn\'t create')
      );
    });

    it('should handle authentication error', async () => {
      mockPersonalityService.removePersonality.mockRejectedValue(
        new Error('Authentication failed')
      );
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('Authentication failed')
      );
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('!tz auth')
      );
    });

    it('should handle general errors', async () => {
      mockPersonalityService.removePersonality.mockRejectedValue(
        new Error('Database error')
      );
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('An error occurred')
      );
    });

    it('should handle missing personality service', async () => {
      mockContext.dependencies.personalityApplicationService = null;
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('An error occurred')
      );
    });

    it('should clear cache for both alias and actual name when different', async () => {
      // Mock finding personality by alias where the actual name is different
      mockContext.args = ['testalias'];
      mockPersonalityService.getPersonality.mockResolvedValue({
        profile: {
          name: 'actualpersonality',
          displayName: 'Actual Personality'
        }
      });
      
      await command.execute(mockContext);
      
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('testalias');
      expect(mockPersonalityService.removePersonality).toHaveBeenCalledWith({
        personalityName: 'actualpersonality',
        requesterId: '123456789'
      });
      
      // Should clear cache for both alias and actual name
      expect(mockMessageTracker.removeCompletedAddCommand).toHaveBeenCalledWith('123456789', 'testalias');
      expect(mockMessageTracker.removeCompletedAddCommand).toHaveBeenCalledWith('123456789', 'actualpersonality');
    });
  });
});