/**
 * @jest-environment node
 * @testType unit
 *
 * CommandAbstraction Test
 * Tests the platform-agnostic command abstraction layer
 */

const {
  Command,
  CommandOption,
  CommandContext,
  CommandRegistry,
  getCommandRegistry,
  resetRegistry,
} = require('../../../../src/application/commands/CommandAbstraction');

describe('CommandAbstraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    resetRegistry();
  });

  describe('Command', () => {
    it('should create a valid command', () => {
      const command = new Command({
        name: 'test',
        description: 'Test command',
        execute: jest.fn(),
      });

      expect(command.name).toBe('test');
      expect(command.description).toBe('Test command');
      expect(command.category).toBe('general');
      expect(command.aliases).toEqual([]);
      expect(command.permissions).toEqual(['USER']);
      expect(command.options).toEqual([]);
    });

    it('should require name', () => {
      expect(
        () =>
          new Command({
            description: 'Test',
            execute: jest.fn(),
          })
      ).toThrow('Command name is required');
    });

    it('should require description', () => {
      expect(
        () =>
          new Command({
            name: 'test',
            execute: jest.fn(),
          })
      ).toThrow('Command description is required');
    });

    it('should require execute function', () => {
      expect(
        () =>
          new Command({
            name: 'test',
            description: 'Test command',
          })
      ).toThrow('Command execute function is required');
    });

    it('should convert to Discord slash command format', () => {
      const command = new Command({
        name: 'test',
        description: 'Test command',
        options: [
          new CommandOption({
            name: 'arg1',
            description: 'First argument',
            type: 'string',
            required: true,
          }),
        ],
        execute: jest.fn(),
      });

      const slashCommand = command.toDiscordSlashCommand();

      expect(slashCommand).toEqual({
        name: 'test',
        description: 'Test command',
        options: [
          {
            name: 'arg1',
            description: 'First argument',
            type: 3, // STRING
            required: true,
          },
        ],
      });
    });

    it('should convert to text command format', () => {
      const command = new Command({
        name: 'test',
        description: 'Test command',
        aliases: ['t'],
        options: [
          new CommandOption({
            name: 'arg1',
            description: 'First argument',
            required: true,
          }),
          new CommandOption({
            name: 'arg2',
            description: 'Second argument',
            required: false,
          }),
        ],
        execute: jest.fn(),
      });

      const textCommand = command.toTextCommand();

      expect(textCommand).toMatchObject({
        name: 'test',
        description: 'Test command',
        // Don't check exact usage since it depends on environment
        aliases: ['t'],
        permissions: ['USER'],
      });
      // Check usage pattern separately to be environment-agnostic
      expect(textCommand.usage).toMatch(/^!\w+ test <arg1> \[arg2\]$/);
      expect(typeof textCommand.execute).toBe('function');
    });

    it('should handle command options with choices', () => {
      const command = new Command({
        name: 'test',
        description: 'Test command',
        options: [
          new CommandOption({
            name: 'choice',
            description: 'Choose one',
            type: 'string',
            choices: [
              { value: 'option1', label: 'Option 1' },
              { value: 'option2', label: 'Option 2' },
            ],
          }),
        ],
        execute: jest.fn(),
      });

      const slashCommand = command.toDiscordSlashCommand();

      expect(slashCommand.options[0].choices).toEqual([
        { name: 'Option 1', value: 'option1' },
        { name: 'Option 2', value: 'option2' },
      ]);
    });
  });

  describe('CommandOption', () => {
    it('should create option with defaults', () => {
      const option = new CommandOption({
        name: 'test',
        description: 'Test option',
      });

      expect(option.name).toBe('test');
      expect(option.description).toBe('Test option');
      expect(option.type).toBe('string');
      expect(option.required).toBe(false);
      expect(option.choices).toEqual([]);
    });

    it('should accept all option properties', () => {
      const option = new CommandOption({
        name: 'test',
        description: 'Test option',
        type: 'integer',
        required: true,
        choices: [{ value: 1, label: 'One' }],
      });

      expect(option.type).toBe('integer');
      expect(option.required).toBe(true);
      expect(option.choices).toHaveLength(1);
    });
  });

  describe('CommandContext', () => {
    it('should create Discord text command context', () => {
      const context = new CommandContext({
        platform: 'discord',
        isSlashCommand: false,
        message: { id: '123' },
        author: { id: 'user123' },
        channel: { id: 'channel123' },
        guild: { id: 'guild123' },
        args: ['arg1', 'arg2'],
      });

      expect(context.platform).toBe('discord');
      expect(context.isSlashCommand).toBe(false);
      expect(context.getUserId()).toBe('user123');
      expect(context.getChannelId()).toBe('channel123');
      expect(context.getGuildId()).toBe('guild123');
      expect(context.getArgument(0)).toBe('arg1');
      expect(context.getArgument(1)).toBe('arg2');
    });

    it('should create Discord slash command context', () => {
      const context = new CommandContext({
        platform: 'discord',
        isSlashCommand: true,
        interaction: { id: '123' },
        author: { id: 'user123' },
        options: { name: 'test', count: 5 },
      });

      expect(context.isSlashCommand).toBe(true);
      expect(context.getArgument('name')).toBe('test');
      expect(context.getArgument('count')).toBe(5);
    });

    it('should handle DM detection for Discord', () => {
      const dmContext = new CommandContext({
        platform: 'discord',
        guild: null,
      });

      const guildContext = new CommandContext({
        platform: 'discord',
        guild: { id: 'guild123' },
      });

      expect(dmContext.isDM()).toBe(true);
      expect(guildContext.isDM()).toBe(false);
    });

    it('should handle DM detection for Revolt', () => {
      const dmContext = new CommandContext({
        platform: 'revolt',
        channel: { channel_type: 'DirectMessage' },
      });

      const guildContext = new CommandContext({
        platform: 'revolt',
        channel: { channel_type: 'TextChannel' },
      });

      expect(dmContext.isDM()).toBe(true);
      expect(guildContext.isDM()).toBe(false);
    });

    it('should handle reply methods', async () => {
      const mockReply = jest.fn().mockResolvedValue({ id: 'msg123' });
      const context = new CommandContext({
        platform: 'discord',
        reply: mockReply,
      });

      await context.respond('Hello');

      expect(mockReply).toHaveBeenCalledWith('Hello', {});
    });

    it('should fallback to message.reply', async () => {
      const mockMessageReply = jest.fn().mockResolvedValue({ id: 'msg123' });
      const context = new CommandContext({
        platform: 'discord',
        message: { reply: mockMessageReply },
      });

      await context.respond('Hello');

      expect(mockMessageReply).toHaveBeenCalledWith('Hello');
    });

    it('should fallback to channel.send', async () => {
      const mockChannelSend = jest.fn().mockResolvedValue({ id: 'msg123' });
      const context = new CommandContext({
        platform: 'discord',
        channel: { send: mockChannelSend },
      });

      await context.respond('Hello');

      expect(mockChannelSend).toHaveBeenCalledWith('Hello');
    });

    it('should handle slash command replies', async () => {
      const mockInteractionReply = jest.fn().mockResolvedValue({});
      const context = new CommandContext({
        platform: 'discord',
        isSlashCommand: true,
        interaction: {
          reply: mockInteractionReply,
          deferred: false,
        },
      });

      await context.respond('Hello');

      expect(mockInteractionReply).toHaveBeenCalledWith('Hello');
    });

    it('should handle deferred slash command replies', async () => {
      const mockEditReply = jest.fn().mockResolvedValue({});
      const context = new CommandContext({
        platform: 'discord',
        isSlashCommand: true,
        interaction: {
          editReply: mockEditReply,
          deferred: true,
        },
      });

      await context.respond('Hello');

      expect(mockEditReply).toHaveBeenCalledWith('Hello');
    });
  });

  describe('CommandRegistry', () => {
    let registry;

    beforeEach(() => {
      registry = new CommandRegistry();
    });

    it('should register commands', () => {
      const command = new Command({
        name: 'test',
        description: 'Test command',
        execute: jest.fn(),
      });

      registry.register(command);

      expect(registry.get('test')).toBe(command);
    });

    it('should register command aliases', () => {
      const command = new Command({
        name: 'test',
        description: 'Test command',
        aliases: ['t', 'tst'],
        execute: jest.fn(),
      });

      registry.register(command);

      expect(registry.get('t')).toBe(command);
      expect(registry.get('tst')).toBe(command);
    });

    it('should require Command instance', () => {
      expect(() => registry.register({ name: 'test' })).toThrow('Must register a Command instance');
    });

    it('should get all commands', () => {
      const cmd1 = new Command({
        name: 'test1',
        description: 'Test 1',
        execute: jest.fn(),
      });
      const cmd2 = new Command({
        name: 'test2',
        description: 'Test 2',
        execute: jest.fn(),
      });

      registry.register(cmd1);
      registry.register(cmd2);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(cmd1);
      expect(all).toContain(cmd2);
    });

    it('should get commands by category', () => {
      const generalCmd = new Command({
        name: 'general',
        description: 'General command',
        category: 'general',
        execute: jest.fn(),
      });
      const adminCmd = new Command({
        name: 'admin',
        description: 'Admin command',
        category: 'admin',
        execute: jest.fn(),
      });

      registry.register(generalCmd);
      registry.register(adminCmd);

      const adminCommands = registry.getByCategory('admin');
      expect(adminCommands).toHaveLength(1);
      expect(adminCommands[0]).toBe(adminCmd);
    });

    it('should export as Discord slash commands', () => {
      const command = new Command({
        name: 'test',
        description: 'Test command',
        execute: jest.fn(),
      });

      registry.register(command);

      const slashCommands = registry.toDiscordSlashCommands();
      expect(slashCommands).toHaveLength(1);
      expect(slashCommands[0].name).toBe('test');
    });

    it('should export as text commands', () => {
      const command = new Command({
        name: 'test',
        description: 'Test command',
        execute: jest.fn(),
      });

      registry.register(command);

      const textCommands = registry.toTextCommands();
      expect(textCommands.test).toBeDefined();
      expect(textCommands.test.name).toBe('test');
    });

    it('should clear all commands', () => {
      const command = new Command({
        name: 'test',
        description: 'Test command',
        aliases: ['t'],
        execute: jest.fn(),
      });

      registry.register(command);
      registry.clear();

      expect(registry.get('test')).toBeNull();
      expect(registry.get('t')).toBeNull();
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe('Singleton management', () => {
    it('should return same registry instance', () => {
      const registry1 = getCommandRegistry();
      const registry2 = getCommandRegistry();

      expect(registry1).toBe(registry2);
    });

    it('should reset registry', () => {
      const registry1 = getCommandRegistry();
      resetRegistry();
      const registry2 = getCommandRegistry();

      expect(registry1).not.toBe(registry2);
    });
  });
});
