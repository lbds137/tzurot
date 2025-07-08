/**
 * @jest-environment node
 * @testType unit
 *
 * AddCommand Test
 * Tests the add personality command
 */

const {
  createAddCommand,
} = require('../../../../../src/application/commands/personality/AddCommand');
const { CommandContext } = require('../../../../../src/application/commands/CommandAbstraction');

// Mock logger
jest.mock('../../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../../../../../src/logger');

describe('AddCommand', () => {
  let command;
  let mockPersonalityService;
  let mockFeatureFlags;
  let mockRequestTracker;
  let mockContext;

  // Mock personality object returned by the service
  const mockPersonality = {
    id: { value: 'test-id' }, // Match the expected structure
    name: 'TestBot',
    profile: {
      name: 'TestBot',
      prompt: 'You are TestBot',
      modelPath: '/default',
      maxWordCount: 1000,
    },
    aliases: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Create command
    command = createAddCommand();

    // Mock services
    mockPersonalityService = {
      registerPersonality: jest.fn(),
      preloadAvatar: jest.fn().mockResolvedValue(undefined),
    };

    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(false),
    };

    mockRequestTracker = {
      isMessageProcessing: jest.fn().mockReturnValue(false),
      markMessageProcessing: jest.fn(),
      generateAddCommandKey: jest.fn((userId, name, alias) => 
        alias ? `${userId}-${name.toLowerCase()}-alias-${alias.toLowerCase()}` : `${userId}-${name.toLowerCase()}`
      ),
      checkRequest: jest.fn().mockReturnValue({
        isPending: false,
        isCompleted: false,
        canProceed: true,
      }),
      markPending: jest.fn(),
      markCompleted: jest.fn(),
      markFailed: jest.fn(),
    };

    // Create base context
    mockContext = new CommandContext({
      platform: 'discord',
      isSlashCommand: false,
      author: { id: 'user123' },
      channel: { id: 'channel123' },
      message: { id: 'msg123' },
      args: [],
      options: {},
      reply: jest.fn().mockResolvedValue({}),
      respond: jest.fn().mockResolvedValue({}),
      commandPrefix: '!tz',
      dependencies: {
        personalityApplicationService: mockPersonalityService,
        featureFlags: mockFeatureFlags,
        requestTrackingService: mockRequestTracker,
      },
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
      expect(command.options).toHaveLength(5);

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

      const aliasOption = command.options.find(o => o.name === 'alias');
      expect(aliasOption).toBeDefined();
      expect(aliasOption.type).toBe('string');
      expect(aliasOption.required).toBe(false);
    });
  });

  describe('text command execution', () => {
    it('should show usage when no arguments provided', async () => {
      mockContext.respond = jest.fn().mockResolvedValue({});

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'How to Add a Personality',
            description: 'Create a new AI personality for your Discord server.',
            color: 0x2196f3,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Basic Usage',
                value: '`!tz add <name> [alias] [prompt]`',
              }),
            ]),
          }),
        ],
      });
      expect(mockPersonalityService.registerPersonality).not.toHaveBeenCalled();
    });

    it('should create personality with name only', async () => {
      mockContext.args = ['TestBot'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
        name: 'TestBot',
        ownerId: 'user123',
        prompt: 'You are TestBot',
        modelPath: '/default',
        maxWordCount: 1000,
        aliases: [],
      });
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Personality Created Successfully!',
            description: expect.stringContaining('TestBot'),
            color: 0x4caf50,
          }),
        ],
      });
    });

    it('should create personality with custom prompt', async () => {
      mockContext.args = ['Claude', 'You', 'are', 'a', 'helpful', 'assistant'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
        name: 'Claude',
        ownerId: 'user123',
        prompt: 'You are a helpful assistant',
        modelPath: '/default',
        maxWordCount: 1000,
        aliases: [],
      });
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Prompt',
                value: 'You are a helpful assistant',
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle quoted prompts', async () => {
      mockContext.args = ['TestBot', '"You are TestBot, a friendly AI"'];
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'You are TestBot, a friendly AI',
        })
      );
    });

    it('should handle single quoted prompts', async () => {
      mockContext.args = ['TestBot', "'You are TestBot'"];
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'You are TestBot',
        })
      );
    });

    it('should create personality with alias only', async () => {
      mockContext.args = ['TestBot', 'tb'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue({
        ...mockPersonality,
        aliases: ['tb'],
      });

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
        name: 'TestBot',
        ownerId: 'user123',
        prompt: 'You are TestBot',
        modelPath: '/default',
        maxWordCount: 1000,
        aliases: ['tb'],
      });
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Alias',
                value: 'tb',
              }),
            ]),
          }),
        ],
      });
    });

    it('should create personality with alias and prompt', async () => {
      mockContext.args = ['TestBot', 'tb', 'You', 'are', 'a', 'test', 'bot'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue({
        ...mockPersonality,
        aliases: ['tb'],
      });

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
        name: 'TestBot',
        ownerId: 'user123',
        prompt: 'You are a test bot',
        modelPath: '/default',
        maxWordCount: 1000,
        aliases: ['tb'],
      });
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Alias',
                value: 'tb',
              }),
            ]),
          }),
        ],
      });
    });

    it('should create personality with alias and quoted prompt', async () => {
      mockContext.args = ['TestBot', 'tb', '"You are a test bot"'];
      mockPersonalityService.registerPersonality.mockResolvedValue({
        ...mockPersonality,
        aliases: ['tb'],
      });

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
        name: 'TestBot',
        ownerId: 'user123',
        prompt: 'You are a test bot',
        modelPath: '/default',
        maxWordCount: 1000,
        aliases: ['tb'],
      });
    });

    it('should validate alias format', async () => {
      mockContext.args = ['TestBot', 'tb@#$'];
      mockContext.respond = jest.fn().mockResolvedValue({});

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Invalid Alias Format',
            description: 'Aliases can only contain letters, numbers, underscores, and hyphens.',
            color: 0xf44336,
          }),
        ],
      });
      expect(mockPersonalityService.registerPersonality).not.toHaveBeenCalled();
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
        maxwords: 2000,
      };
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
        name: 'TestBot',
        ownerId: 'user123',
        prompt: 'Custom prompt',
        modelPath: '/gpt-4',
        maxWordCount: 2000,
        aliases: [],
      });
    });

    it('should use defaults for missing options', async () => {
      mockContext.options = {
        name: 'TestBot',
      };
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
        name: 'TestBot',
        ownerId: 'user123',
        prompt: 'You are TestBot',
        modelPath: '/default',
        maxWordCount: 1000,
        aliases: [],
      });
    });

    it('should create personality with alias option', async () => {
      mockContext.options = {
        name: 'TestBot',
        alias: 'tb',
      };
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue({
        ...mockPersonality,
        aliases: ['tb'],
      });

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
        name: 'TestBot',
        ownerId: 'user123',
        prompt: 'You are TestBot',
        modelPath: '/default',
        maxWordCount: 1000,
        aliases: ['tb'],
      });
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Alias',
                value: 'tb',
              }),
            ]),
          }),
        ],
      });
    });
  });

  describe('validation', () => {
    it('should reject short names', async () => {
      mockContext.options = { name: 'A' };
      mockContext.isSlashCommand = true;
      mockContext.respond = jest.fn().mockResolvedValue({});

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Invalid Name',
            description: 'Personality name must be at least 2 characters long.',
            color: 0xf44336,
          }),
        ],
      });
      expect(mockPersonalityService.registerPersonality).not.toHaveBeenCalled();
    });

    it('should reject long names', async () => {
      mockContext.options = { name: 'A'.repeat(51) };
      mockContext.isSlashCommand = true;
      mockContext.respond = jest.fn().mockResolvedValue({});

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Name Too Long',
            description: 'Personality name must be 50 characters or less.',
            color: 0xf44336,
          }),
        ],
      });
      expect(mockPersonalityService.registerPersonality).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle service not available', async () => {
      mockContext.dependencies.personalityApplicationService = null;
      mockContext.args = ['TestBot'];
      mockContext.respond = jest.fn().mockResolvedValue({});

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Something Went Wrong',
            description: expect.stringContaining(
              'An error occurred while creating the personality'
            ),
            color: 0xf44336,
          }),
        ],
      });
      expect(logger.error).toHaveBeenCalledWith('[AddCommand] Error:', expect.any(Error));
    });

    it('should handle already exists error', async () => {
      mockContext.args = ['TestBot'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockRejectedValue(
        new Error('Personality already exists')
      );

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Personality Already Exists',
            description: expect.stringContaining('already exists'),
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle authentication error', async () => {
      mockContext.args = ['TestBot'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockRejectedValue(
        new Error('Authentication failed')
      );

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Authentication Required',
            description: 'You need to authenticate before creating personalities.',
            color: 0xff9800,
          }),
        ],
      });
    });

    it('should handle service failure', async () => {
      mockContext.args = ['TestBot'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockRejectedValue(
        new Error('Service unavailable')
      );

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Something Went Wrong',
            description: expect.stringContaining('An error occurred'),
            color: 0xf44336,
          }),
        ],
      });
      expect(logger.error).toHaveBeenCalledWith('[AddCommand] Error:', expect.any(Error));
    });

    it('should handle generic errors', async () => {
      mockContext.args = ['TestBot'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockRejectedValue(new Error('Unknown error'));

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Something Went Wrong',
            description: expect.stringContaining(
              'An error occurred while creating the personality'
            ),
            color: 0xf44336,
          }),
        ],
      });
      expect(logger.error).toHaveBeenCalledWith('[AddCommand] Error:', expect.any(Error));
    });
  });

  describe('logging', () => {
    it('should log command execution', async () => {
      mockContext.args = ['TestBot'];
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[AddCommand] Creating personality "TestBot"')
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[AddCommand] Successfully created personality "TestBot"')
      );
    });
  });

  describe('duplicate protection', () => {
    it('should check for message processing', async () => {
      mockContext.args = ['TestBot'];
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockRequestTracker.isMessageProcessing).toHaveBeenCalledWith('msg123');
      expect(mockRequestTracker.markMessageProcessing).toHaveBeenCalledWith('msg123');
    });

    it('should return null if message is already being processed', async () => {
      mockContext.args = ['TestBot'];
      mockRequestTracker.isMessageProcessing.mockReturnValue(true);
      // Make sure respond is a mock
      mockContext.respond = jest.fn();

      const result = await command.execute(mockContext);

      expect(result).toBeNull();
      expect(mockPersonalityService.registerPersonality).not.toHaveBeenCalled();
      expect(mockContext.respond).not.toHaveBeenCalled();
    });

    it('should check request status before proceeding', async () => {
      mockContext.args = ['TestBot', 'tb'];
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockRequestTracker.generateAddCommandKey).toHaveBeenCalledWith('user123', 'TestBot', 'tb');
      expect(mockRequestTracker.checkRequest).toHaveBeenCalledWith('user123-testbot-alias-tb');
    });

    it('should return null if request is pending', async () => {
      mockContext.args = ['TestBot'];
      mockRequestTracker.checkRequest.mockReturnValue({
        isPending: true,
        isCompleted: false,
        canProceed: false,
        reason: 'Request is already in progress',
      });
      // Make sure respond is a mock
      mockContext.respond = jest.fn();

      const result = await command.execute(mockContext);

      expect(result).toBeNull();
      expect(mockPersonalityService.registerPersonality).not.toHaveBeenCalled();
      expect(mockContext.respond).not.toHaveBeenCalled();
    });

    it('should show warning if request was recently completed', async () => {
      mockContext.args = ['TestBot'];
      mockRequestTracker.checkRequest.mockReturnValue({
        isPending: false,
        isCompleted: true,
        canProceed: false,
        reason: 'Request was recently completed',
      });
      mockContext.respond = jest.fn().mockResolvedValue({});

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '⚠️ Request Already Processed',
            description: expect.stringContaining('was just created'),
            color: 0xff9800,
          }),
        ],
      });
      expect(mockPersonalityService.registerPersonality).not.toHaveBeenCalled();
    });

    it('should mark request as pending when starting', async () => {
      mockContext.args = ['TestBot', 'tb'];
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockRequestTracker.markPending).toHaveBeenCalledWith(
        'user123-testbot-alias-tb',
        {
          userId: 'user123',
          personalityName: 'TestBot',
          alias: 'tb',
        }
      );
    });

    it('should mark request as completed on success', async () => {
      mockContext.args = ['TestBot'];
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockRequestTracker.markCompleted).toHaveBeenCalledWith(
        'user123-testbot',
        {
          success: true,
          personalityId: 'test-id',
        }
      );
    });

    it('should mark request as failed on service error', async () => {
      mockContext.args = ['TestBot'];
      mockPersonalityService.registerPersonality.mockRejectedValue(
        new Error('Service error')
      );

      await command.execute(mockContext);

      expect(mockRequestTracker.markFailed).toHaveBeenCalledWith('user123-testbot');
    });

    it('should mark request as failed on generic error', async () => {
      mockContext.args = ['TestBot'];
      // Simulate an error by removing the service
      mockContext.dependencies.personalityApplicationService = null;

      await command.execute(mockContext);

      expect(mockRequestTracker.markFailed).toHaveBeenCalledWith('user123-testbot');
    });

    it('should work without request tracker', async () => {
      mockContext.dependencies.requestTrackingService = null;
      mockContext.args = ['TestBot'];
      // Make sure personalityApplicationService is available
      mockContext.dependencies.personalityApplicationService = mockPersonalityService;
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);
      // Make sure respond is mocked
      mockContext.respond = jest.fn().mockResolvedValue({});

      await command.execute(mockContext);

      expect(mockPersonalityService.registerPersonality).toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Personality Created Successfully!',
          }),
        ],
      });
    });
  });

  describe('avatar preloading', () => {
    it('should trigger avatar preloading after successful registration', async () => {
      mockContext.args = ['TestBot'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      // Wait for async operations
      await Promise.resolve();

      expect(mockPersonalityService.preloadAvatar).toHaveBeenCalledWith('TestBot', 'user123');
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Personality Created Successfully!',
          }),
        ],
      });
    });

    it('should handle avatar preloading errors gracefully', async () => {
      mockContext.args = ['TestBot'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);
      mockPersonalityService.preloadAvatar.mockRejectedValue(new Error('Avatar preload failed'));

      await command.execute(mockContext);

      // Wait for async operations
      await Promise.resolve();

      expect(mockPersonalityService.preloadAvatar).toHaveBeenCalledWith('TestBot', 'user123');
      // Command should still succeed
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Personality Created Successfully!',
          }),
        ],
      });
    });

    it('should include avatar URL in embed if available', async () => {
      const personalityWithAvatar = {
        ...mockPersonality,
        profile: {
          ...mockPersonality.profile,
          avatarUrl: 'https://example.com/avatar.png',
        },
      };
      mockContext.args = ['TestBot'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue(personalityWithAvatar);

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            thumbnail: { url: 'https://example.com/avatar.png' },
          }),
        ],
      });
    });

    it('should use profile avatar URL as fallback', async () => {
      const personalityWithProfileAvatar = {
        ...mockPersonality,
        profile: {
          ...mockPersonality.profile,
          avatarUrl: 'https://example.com/profile-avatar.png',
        },
      };
      mockContext.args = ['TestBot'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue(personalityWithProfileAvatar);

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            thumbnail: { url: 'https://example.com/profile-avatar.png' },
          }),
        ],
      });
    });

    it('should work when service does not support avatar preloading', async () => {
      // Remove preloadAvatar method
      delete mockPersonalityService.preloadAvatar;
      mockContext.args = ['TestBot'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      // Should not throw and should complete successfully
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Personality Created Successfully!',
          }),
        ],
      });
    });
  });

  describe('alias collision handling', () => {
    it('should display alternate alias when collision occurs', async () => {
      const personalityWithAlternateAlias = {
        ...mockPersonality,
        alternateAliases: ['tb-testbot'],
      };
      
      mockContext.args = ['TestBot', 'tb'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue(personalityWithAlternateAlias);

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Alias',
                value: 'tb-testbot (requested: tb)',
              }),
            ]),
          }),
        ],
      });
    });

    it('should display original alias when no collision occurs', async () => {
      mockContext.args = ['TestBot', 'tb'];
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue({
        ...mockPersonality,
        aliases: ['tb'],
      });

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Alias',
                value: 'tb',
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle slash command with alias collision', async () => {
      const personalityWithAlternateAlias = {
        ...mockPersonality,
        alternateAliases: ['bot-testbot'],
      };
      
      mockContext.isSlashCommand = true;
      mockContext.options = {
        name: 'TestBot',
        alias: 'bot',
      };
      mockContext.respond = jest.fn().mockResolvedValue({});
      mockPersonalityService.registerPersonality.mockResolvedValue(personalityWithAlternateAlias);

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Alias',
                value: 'bot-testbot (requested: bot)',
              }),
            ]),
          }),
        ],
      });
    });
  });
});
