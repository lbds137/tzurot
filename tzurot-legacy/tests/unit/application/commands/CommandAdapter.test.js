/**
 * @jest-environment node
 * @testType unit
 *
 * CommandAdapter Test
 * Tests the platform command adapters
 */

const {
  DiscordCommandAdapter,
  RevoltCommandAdapter,
  CommandAdapterFactory,
} = require('../../../../src/application/commands/CommandAdapter');
const {
  Command,
  CommandOption,
  getCommandRegistry,
  resetRegistry,
} = require('../../../../src/application/commands/CommandAbstraction');
const { botPrefix } = require('../../../../config');

// Mock Discord.js
jest.mock('discord.js', () => ({
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
  })),
}));

// Mock logger
jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const logger = require('../../../../src/logger');

describe('CommandAdapter', () => {
  let registry;
  let testCommand;
  let mockApplicationServices;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    resetRegistry();
    registry = getCommandRegistry();

    // Create test command
    testCommand = new Command({
      name: 'test',
      description: 'Test command',
      category: 'testing',
      execute: jest.fn().mockResolvedValue('Command executed'),
    });
    registry.register(testCommand);

    // Mock application services
    mockApplicationServices = {
      personalityApplicationService: {
        registerPersonality: jest.fn(),
      },
      featureFlags: {
        isEnabled: jest.fn(),
      },
      messageTracker: {
        track: jest.fn().mockReturnValue(true), // Default to allowing commands
      },
    };
  });

  describe('DiscordCommandAdapter', () => {
    let adapter;

    beforeEach(() => {
      adapter = new DiscordCommandAdapter({
        commandRegistry: registry,
        applicationServices: mockApplicationServices,
      });
    });

    describe('handleTextCommand', () => {
      it('should handle valid text command', async () => {
        const mockMessage = {
          id: '123456789',
          author: { id: 'user123', username: 'testuser' },
          channel: { id: 'channel123' },
          guild: { id: 'guild123' },
          reply: jest.fn().mockResolvedValue({}),
        };

        const result = await adapter.handleTextCommand(mockMessage, 'test', ['arg1', 'arg2']);

        expect(result).toBe('Command executed');
        expect(testCommand.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            platform: 'discord',
            isSlashCommand: false,
            message: mockMessage,
            author: mockMessage.author,
            channel: mockMessage.channel,
            guild: mockMessage.guild,
            args: ['arg1', 'arg2'],
          })
        );
      });

      it('should track messages to prevent duplicates', async () => {
        const mockMessage = {
          id: '123456789',
          author: { id: 'user123' },
          channel: { id: 'channel123' },
          guild: { id: 'guild123' },
          reply: jest.fn().mockResolvedValue({}),
        };

        await adapter.handleTextCommand(mockMessage, 'test', []);

        expect(mockApplicationServices.messageTracker.track).toHaveBeenCalledWith(
          '123456789',
          'ddd-command'
        );
      });

      it('should prevent duplicate command execution', async () => {
        const mockMessage = {
          id: '123456789',
          author: { id: 'user123' },
          channel: { id: 'channel123' },
          guild: { id: 'guild123' },
          reply: jest.fn().mockResolvedValue({}),
        };

        // Simulate duplicate detection
        mockApplicationServices.messageTracker.track.mockReturnValue(false);

        const result = await adapter.handleTextCommand(mockMessage, 'test', []);

        expect(result).toEqual({ success: true, duplicate: true });
        expect(testCommand.execute).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
          '[DiscordCommandAdapter] Prevented duplicate command processing for message 123456789'
        );
      });

      it('should handle missing message tracker gracefully', async () => {
        const mockMessage = {
          id: '123456789',
          author: { id: 'user123' },
          channel: { id: 'channel123' },
          guild: { id: 'guild123' },
          reply: jest.fn().mockResolvedValue({}),
        };

        // Remove message tracker
        mockApplicationServices.messageTracker = null;

        const result = await adapter.handleTextCommand(mockMessage, 'test', []);

        expect(result).toBe('Command executed');
        expect(testCommand.execute).toHaveBeenCalled();
      });

      it('should return null for unknown command', async () => {
        const mockMessage = {
          id: '123456789',
          author: { id: 'user123' },
          channel: { id: 'channel123' },
          guild: null,
          reply: jest.fn(),
        };

        const result = await adapter.handleTextCommand(mockMessage, 'unknown', []);

        expect(result).toBeNull();
        expect(testCommand.execute).not.toHaveBeenCalled();
      });

      it('should handle command execution errors', async () => {
        testCommand.execute.mockRejectedValue(new Error('Command failed'));
        const mockMessage = {
          id: '123456789',
          author: { id: 'user123' },
          channel: { id: 'channel123' },
          guild: null,
          reply: jest.fn(),
        };

        await expect(adapter.handleTextCommand(mockMessage, 'test', [])).rejects.toThrow(
          'Command failed'
        );

        expect(logger.error).toHaveBeenCalledWith(
          '[DiscordCommandAdapter] Error handling text command test:',
          expect.any(Error)
        );
      });
    });

    describe('handleSlashCommand', () => {
      it('should handle valid slash command', async () => {
        const mockInteraction = {
          commandName: 'test',
          user: { id: 'user123', username: 'testuser' },
          channel: { id: 'channel123' },
          guild: { id: 'guild123' },
          options: {
            data: [
              { name: 'arg1', value: 'value1' },
              { name: 'arg2', value: 'value2' },
            ],
          },
          deferred: false,
          replied: false,
          reply: jest.fn().mockResolvedValue({}),
        };

        const result = await adapter.handleSlashCommand(mockInteraction);

        expect(result).toBe('Command executed');
        expect(testCommand.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            platform: 'discord',
            isSlashCommand: true,
            interaction: mockInteraction,
            author: mockInteraction.user,
            options: { arg1: 'value1', arg2: 'value2' },
          })
        );
      });

      it('should handle unknown slash command', async () => {
        const mockInteraction = {
          commandName: 'unknown',
          reply: jest.fn().mockResolvedValue({}),
        };

        await adapter.handleSlashCommand(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: 'Unknown command',
          ephemeral: true,
        });
      });

      it('should handle deferred interactions', async () => {
        testCommand.execute.mockImplementation(async ctx => {
          return await ctx.respond('Response');
        });

        const mockInteraction = {
          commandName: 'test',
          user: { id: 'user123' },
          options: { data: [] },
          deferred: true,
          editReply: jest.fn().mockResolvedValue({}),
        };

        await adapter.handleSlashCommand(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith('Response');
      });

      it('should handle slash command errors', async () => {
        testCommand.execute.mockRejectedValue(new Error('Command failed'));
        const mockInteraction = {
          commandName: 'test',
          user: { id: 'user123' },
          options: { data: [] },
          deferred: false,
          replied: false,
          reply: jest.fn().mockResolvedValue({}),
        };

        await adapter.handleSlashCommand(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: 'An error occurred while executing the command',
          ephemeral: true,
        });
        expect(logger.error).toHaveBeenCalled();
      });

      it('should edit reply for errors on deferred interactions', async () => {
        testCommand.execute.mockRejectedValue(new Error('Command failed'));
        const mockInteraction = {
          commandName: 'test',
          user: { id: 'user123' },
          options: { data: [] },
          deferred: true,
          editReply: jest.fn().mockResolvedValue({}),
        };

        await adapter.handleSlashCommand(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
          'An error occurred while executing the command'
        );
      });
    });

    describe('registerSlashCommands', () => {
      it('should register commands to specific guild', async () => {
        const mockGuild = {
          commands: {
            set: jest.fn().mockResolvedValue([]),
          },
        };
        const mockClient = {
          guilds: {
            fetch: jest.fn().mockResolvedValue(mockGuild),
          },
        };

        const result = await adapter.registerSlashCommands(mockClient, 'guild123');

        expect(mockClient.guilds.fetch).toHaveBeenCalledWith('guild123');
        expect(mockGuild.commands.set).toHaveBeenCalledWith([
          {
            name: 'test',
            description: 'Test command',
            options: [],
          },
        ]);
        expect(result).toHaveLength(1);
        expect(logger.info).toHaveBeenCalledWith(
          '[DiscordCommandAdapter] Registered 1 slash commands to guild guild123'
        );
      });

      it('should register commands globally', async () => {
        const mockClient = {
          application: {
            commands: {
              set: jest.fn().mockResolvedValue([]),
            },
          },
        };

        const result = await adapter.registerSlashCommands(mockClient);

        expect(mockClient.application.commands.set).toHaveBeenCalledWith([
          {
            name: 'test',
            description: 'Test command',
            options: [],
          },
        ]);
        expect(logger.info).toHaveBeenCalledWith(
          '[DiscordCommandAdapter] Registered 1 slash commands globally'
        );
      });

      it('should handle registration errors', async () => {
        const mockClient = {
          guilds: {
            fetch: jest.fn().mockRejectedValue(new Error('Guild not found')),
          },
        };

        await expect(adapter.registerSlashCommands(mockClient, 'guild123')).rejects.toThrow(
          'Guild not found'
        );

        expect(logger.error).toHaveBeenCalledWith(
          '[DiscordCommandAdapter] Error registering slash commands:',
          expect.any(Error)
        );
      });
    });

    describe('createHelpEmbed', () => {
      it('should create help embed with commands grouped by category', () => {
        // Add more commands
        const adminCommand = new Command({
          name: 'admin',
          description: 'Admin command',
          category: 'admin',
          execute: jest.fn(),
        });
        registry.register(adminCommand);

        const embed = adapter.createHelpEmbed();

        expect(embed.setTitle).toHaveBeenCalledWith('Available Commands');
        expect(embed.setColor).toHaveBeenCalledWith(0x00ae86);
        expect(embed.addFields).toHaveBeenCalledTimes(2); // Two categories
        expect(embed.setFooter).toHaveBeenCalledWith({
          text: `Use ${botPrefix} <command> for text commands or /<command> for slash commands`,
        });
      });
    });
  });

  describe('RevoltCommandAdapter', () => {
    let adapter;

    beforeEach(() => {
      adapter = new RevoltCommandAdapter({
        commandRegistry: registry,
        applicationServices: mockApplicationServices,
      });
    });

    describe('handleTextCommand', () => {
      it('should handle valid text command', async () => {
        const mockMessage = {
          author: { id: 'user123', username: 'testuser' },
          channel: { id: 'channel123' },
          server: { id: 'server123' }, // Revolt uses 'server'
          reply: jest.fn().mockResolvedValue({}),
        };

        const result = await adapter.handleTextCommand(mockMessage, 'test', ['arg1']);

        expect(result).toBe('Command executed');
        expect(testCommand.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            platform: 'revolt',
            isSlashCommand: false,
            message: mockMessage,
            author: mockMessage.author,
            channel: mockMessage.channel,
            guild: mockMessage.server,
            args: ['arg1'],
          })
        );
      });

      it('should return null for unknown command', async () => {
        const mockMessage = {
          author: { id: 'user123' },
          channel: { id: 'channel123' },
          server: null,
          reply: jest.fn(),
        };

        const result = await adapter.handleTextCommand(mockMessage, 'unknown', []);

        expect(result).toBeNull();
      });

      it('should handle command execution errors', async () => {
        testCommand.execute.mockRejectedValue(new Error('Command failed'));
        const mockMessage = {
          author: { id: 'user123' },
          channel: { id: 'channel123' },
          server: { id: 'server123' },
          reply: jest.fn(),
        };

        await expect(adapter.handleTextCommand(mockMessage, 'test', [])).rejects.toThrow(
          'Command failed'
        );

        expect(logger.error).toHaveBeenCalledWith(
          '[RevoltCommandAdapter] Error handling text command test:',
          expect.any(Error)
        );
      });
    });

    describe('createHelpMessage', () => {
      it('should create help message with commands grouped by category', () => {
        // Add command with usage info
        const commandWithUsage = new Command({
          name: 'example',
          description: 'Example command',
          category: 'general',
          options: [new CommandOption({ name: 'arg', required: true })],
          execute: jest.fn(),
        });
        registry.register(commandWithUsage);

        const helpMessage = adapter.createHelpMessage();

        expect(helpMessage).toContain('**Available Commands**');
        expect(helpMessage).toContain('**Testing**');
        // Use regex to match any prefix
        expect(helpMessage).toMatch(/• `!\w+ test` - Test command/);
        expect(helpMessage).toContain('**General**');
        expect(helpMessage).toMatch(/• `!\w+ example <arg>` - Example command/);
      });
    });
  });

  describe('CommandAdapterFactory', () => {
    it('should create Discord adapter', () => {
      const adapter = CommandAdapterFactory.create('discord', {
        commandRegistry: registry,
        applicationServices: mockApplicationServices,
      });

      expect(adapter).toBeInstanceOf(DiscordCommandAdapter);
    });

    it('should create Revolt adapter', () => {
      const adapter = CommandAdapterFactory.create('revolt', {
        commandRegistry: registry,
        applicationServices: mockApplicationServices,
      });

      expect(adapter).toBeInstanceOf(RevoltCommandAdapter);
    });

    it('should handle case-insensitive platform names', () => {
      const adapter = CommandAdapterFactory.create('DISCORD', {
        commandRegistry: registry,
        applicationServices: mockApplicationServices,
      });

      expect(adapter).toBeInstanceOf(DiscordCommandAdapter);
    });

    it('should throw for unsupported platform', () => {
      expect(() => CommandAdapterFactory.create('telegram', {})).toThrow(
        'Unsupported platform: telegram'
      );
    });
  });
});
