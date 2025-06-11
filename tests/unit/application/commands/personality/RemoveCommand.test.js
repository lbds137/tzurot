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
  let migrationHelper;

  beforeEach(() => {
    migrationHelper = createMigrationHelper();
    
    // Create the command
    command = createRemoveCommand();
    
    // Mock personality service
    mockPersonalityService = {
      removePersonality: jest.fn().mockResolvedValue({ success: true })
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
        featureFlags: mockFeatureFlags
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
      
      expect(mockPersonalityService.removePersonality).toHaveBeenCalledWith(
        'testpersonality',
        '123456789'
      );
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('✅ **testpersonality** has been removed'),
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
      mockContext.options = { name: 'slashpersonality' };
      
      await command.execute(mockContext);
      
      expect(mockPersonalityService.removePersonality).toHaveBeenCalledWith(
        'slashpersonality',
        '123456789'
      );
    });

    it('should handle personality not found error', async () => {
      mockPersonalityService.removePersonality.mockResolvedValue({
        success: false,
        message: 'Personality not found'
      });
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      );
    });

    it('should handle permission error', async () => {
      mockPersonalityService.removePersonality.mockResolvedValue({
        success: false,
        message: 'Only the owner can remove a personality'
      });
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('cannot remove a personality that you didn\'t create')
      );
    });

    it('should handle authentication error', async () => {
      mockPersonalityService.removePersonality.mockResolvedValue({
        success: false,
        message: 'Authentication failed'
      });
      
      await command.execute(mockContext);
      
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('Authentication failed')
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
  });
});