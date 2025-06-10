/**
 * @jest-environment node
 * @testType unit
 * 
 * AddCommand Test
 * Tests the add personality command
 */

const { createAddCommand } = require('../../../../../src/application/commands/personality/AddCommand');
const { CommandContext } = require('../../../../../src/application/commands/CommandAbstraction');

// Mock logger
jest.mock('../../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

const logger = require('../../../../../src/logger');

describe('AddCommand', () => {
  let command;
  let mockPersonalityService;
  let mockFeatureFlags;
  let mockContext;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Create command
    command = createAddCommand();

    // Mock services
    mockPersonalityService = {
      registerPersonality: jest.fn()
    };

    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(false)
    };

    // Create base context
    mockContext = new CommandContext({
      platform: 'discord',
      isSlashCommand: false,
      author: { id: 'user123' },
      channel: { id: 'channel123' },
      args: [],
      options: {},
      reply: jest.fn().mockResolvedValue({}),
      dependencies: {
        personalityApplicationService: mockPersonalityService,
        featureFlags: mockFeatureFlags
      }
    });
  });

  describe('command definition', () => {
    it('should have correct metadata', () => {
      expect(command.name).toBe('add');
      expect(command.description).toBe('Add a new personality to the bot');
      expect(command.category).toBe('personality');
      expect(command.aliases).toEqual(['create', 'new']);
      expect(command.permissions).toEqual(['USER']);
    });

    it('should have correct options', () => {
      expect(command.options).toHaveLength(4);
      
      const nameOption = command.options.find(o => o.name === 'name');
      expect(nameOption).toBeDefined();
      expect(nameOption.required).toBe(true);
      expect(nameOption.type).toBe('string');
      
      const promptOption = command.options.find(o => o.name === 'prompt');
      expect(promptOption).toBeDefined();
      expect(promptOption.required).toBe(false);
      
      const modelOption = command.options.find(o => o.name === 'model');
      expect(modelOption).toBeDefined();
      expect(modelOption.required).toBe(false);
      
      const maxWordsOption = command.options.find(o => o.name === 'maxwords');
      expect(maxWordsOption).toBeDefined();
      expect(maxWordsOption.type).toBe('integer');
      expect(maxWordsOption.required).toBe(false);
    });
  });

  describe('text command execution', () => {
    it('should show usage when no arguments provided', async () => {
      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith(
        expect.stringContaining('Usage: `!tz add <name> [prompt]`'),
        {}
      );
      expect(mockPersonalityService.registerPersonality).not.toHaveBeenCalled();
    });

    it('should create personality with name only', async () => {
      mockContext.args = ['TestBot'];
      mockPersonalityService.registerPersonality.mockResolvedValue({
        success: true
      });

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
        name: 'TestBot',
        ownerId: 'user123',
        prompt: 'You are TestBot',
        modelPath: '/default',
        maxWordCount: 1000,
        aliases: []
      });
      expect(mockContext.reply).toHaveBeenCalledWith(
        expect.stringContaining('✅ Successfully created personality **TestBot**'),
        {}
      );
    });

    it('should create personality with custom prompt', async () => {
      mockContext.args = ['Claude', 'You', 'are', 'a', 'helpful', 'assistant'];
      mockPersonalityService.registerPersonality.mockResolvedValue({
        success: true
      });

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
        name: 'Claude',
        ownerId: 'user123',
        prompt: 'You are a helpful assistant',
        modelPath: '/default',
        maxWordCount: 1000,
        aliases: []
      });
      expect(mockContext.reply).toHaveBeenCalledWith(
        expect.stringContaining('Prompt: "You are a helpful assistant"'),
        {}
      );
    });

    it('should handle quoted prompts', async () => {
      mockContext.args = ['TestBot', '"You are TestBot, a friendly AI"'];
      mockPersonalityService.registerPersonality.mockResolvedValue({
        success: true
      });

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'You are TestBot, a friendly AI'
        })
      );
    });

    it('should handle single quoted prompts', async () => {
      mockContext.args = ['TestBot', "'You are TestBot'"];
      mockPersonalityService.registerPersonality.mockResolvedValue({
        success: true
      });

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'You are TestBot'
        })
      );
    });

    it('should show new system indicator when feature flag enabled', async () => {
      mockContext.args = ['TestBot'];
      mockFeatureFlags.isEnabled.mockReturnValue(true);
      mockPersonalityService.registerPersonality.mockResolvedValue({
        success: true
      });

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith(
        expect.stringContaining('*(Using new DDD system)*'),
        {}
      );
    });
  });

  describe('slash command execution', () => {
    beforeEach(() => {
      mockContext.isSlashCommand = true;
    });

    it('should create personality with all options', async () => {
      mockContext.options = {
        name: 'TestBot',
        prompt: 'Custom prompt',
        model: '/gpt-4',
        maxwords: 2000
      };
      mockPersonalityService.registerPersonality.mockResolvedValue({
        success: true
      });

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
        name: 'TestBot',
        ownerId: 'user123',
        prompt: 'Custom prompt',
        modelPath: '/gpt-4',
        maxWordCount: 2000,
        aliases: []
      });
    });

    it('should use defaults for missing options', async () => {
      mockContext.options = {
        name: 'TestBot'
      };
      mockPersonalityService.registerPersonality.mockResolvedValue({
        success: true
      });

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
        name: 'TestBot',
        ownerId: 'user123',
        prompt: 'You are TestBot',
        modelPath: '/default',
        maxWordCount: 1000,
        aliases: []
      });
    });
  });

  describe('validation', () => {
    it('should reject short names', async () => {
      mockContext.options = { name: 'A' };
      mockContext.isSlashCommand = true;

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith(
        'Personality name must be at least 2 characters long.',
        {}
      );
      expect(mockPersonalityService.registerPersonality).not.toHaveBeenCalled();
    });

    it('should reject long names', async () => {
      mockContext.options = { name: 'A'.repeat(51) };
      mockContext.isSlashCommand = true;

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith(
        'Personality name must be 50 characters or less.',
        {}
      );
      expect(mockPersonalityService.registerPersonality).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle service not available', async () => {
      mockContext.dependencies.personalityApplicationService = null;
      mockContext.args = ['TestBot'];

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith(
        expect.stringContaining('An error occurred while creating the personality'),
        {}
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[AddCommand] Error:',
        expect.any(Error)
      );
    });

    it('should handle already exists error', async () => {
      mockContext.args = ['TestBot'];
      mockPersonalityService.registerPersonality.mockRejectedValue(
        new Error('Personality already exists')
      );

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith(
        expect.stringContaining('already exists'),
        {}
      );
    });

    it('should handle authentication error', async () => {
      mockContext.args = ['TestBot'];
      mockPersonalityService.registerPersonality.mockRejectedValue(
        new Error('Authentication failed')
      );

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith(
        expect.stringContaining('Authentication failed'),
        {}
      );
    });

    it('should handle service failure', async () => {
      mockContext.args = ['TestBot'];
      mockPersonalityService.registerPersonality.mockResolvedValue({
        success: false,
        error: 'Service unavailable'
      });

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith(
        expect.stringContaining('An error occurred'),
        {}
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[AddCommand] Error:',
        expect.any(Error)
      );
    });

    it('should handle generic errors', async () => {
      mockContext.args = ['TestBot'];
      mockPersonalityService.registerPersonality.mockRejectedValue(
        new Error('Unknown error')
      );

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith(
        expect.stringContaining('An error occurred while creating the personality'),
        {}
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[AddCommand] Error:',
        expect.any(Error)
      );
    });
  });

  describe('logging', () => {
    it('should log command execution', async () => {
      mockContext.args = ['TestBot'];
      mockPersonalityService.registerPersonality.mockResolvedValue({
        success: true
      });

      await command.execute(mockContext);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[AddCommand] Creating personality "TestBot"')
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[AddCommand] Successfully created personality "TestBot"')
      );
    });

    it('should log system used', async () => {
      mockContext.args = ['TestBot'];
      mockFeatureFlags.isEnabled.mockReturnValue(true);
      mockPersonalityService.registerPersonality.mockResolvedValue({
        success: true
      });

      await command.execute(mockContext);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('using new system')
      );
    });
  });
});