/**
 * Tests for HelpCommand
 */

const {
  createHelpCommand,
  getCategoryForCommand,
  getCommandSpecificHelp,
} = require('../../../../../src/application/commands/utility/HelpCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');
const {
  Command,
  CommandOption,
} = require('../../../../../src/application/commands/CommandAbstraction');
const logger = require('../../../../../src/logger');

// Mock logger
jest.mock('../../../../../src/logger');

describe('HelpCommand', () => {
  let mockRegistry;
  let mockContext;
  let migrationHelper;
  let testCommands;

  beforeEach(() => {
    jest.clearAllMocks();
    migrationHelper = createMigrationHelper();

    // Create test commands
    testCommands = {
      add: new Command({
        name: 'add',
        description: 'Add a new personality',
        category: 'personality',
        aliases: ['create'],
        permissions: ['USER'],
        options: [
          new CommandOption({
            name: 'name',
            description: 'Personality name',
            type: 'string',
            required: true,
          }),
          new CommandOption({
            name: 'alias',
            description: 'Optional alias',
            type: 'string',
            required: false,
          }),
        ],
        execute: jest.fn(),
      }),
      list: new Command({
        name: 'list',
        description: 'List all personalities',
        category: 'personality',
        aliases: [],
        permissions: ['USER'],
        options: [
          new CommandOption({
            name: 'page',
            description: 'Page number',
            type: 'integer',
            required: false,
          }),
        ],
        execute: jest.fn(),
      }),
      auth: new Command({
        name: 'auth',
        description: 'Authenticate with the AI service',
        category: 'authentication',
        aliases: [],
        permissions: ['USER'],
        options: [
          new CommandOption({
            name: 'action',
            description: 'Action to perform',
            type: 'string',
            required: false,
            choices: [
              { value: 'start', label: 'Start authentication' },
              { value: 'status', label: 'Check status' },
            ],
          }),
        ],
        execute: jest.fn(),
      }),
      debug: new Command({
        name: 'debug',
        description: 'Debug tools',
        category: 'admin',
        aliases: [],
        permissions: ['ADMIN'],
        options: [],
        execute: jest.fn(),
      }),
      volumetest: new Command({
        name: 'volumetest',
        description: 'Test volume',
        category: 'admin',
        aliases: [],
        permissions: ['OWNER'],
        options: [],
        execute: jest.fn(),
      }),
    };

    // Mock command registry
    mockRegistry = {
      get: jest.fn(name => {
        // Check main names and aliases
        for (const cmd of Object.values(testCommands)) {
          if (cmd.name === name || cmd.aliases.includes(name)) {
            return cmd;
          }
        }
        return null;
      }),
      getAll: jest.fn(() => Object.values(testCommands)),
    };

    // Mock context
    mockContext = {
      userId: 'user123',
      channelId: 'channel123',
      guildId: 'guild123',
      commandPrefix: '!tz',
      isDM: false,
      isAdmin: false,
      args: [],
      options: {},
      respond: jest.fn().mockResolvedValue(undefined),
      respondWithEmbed: jest.fn().mockResolvedValue(undefined),
    };
  });

  describe('Command Creation', () => {
    it('should create command with correct metadata', () => {
      const command = createHelpCommand();

      expect(command.name).toBe('help');
      expect(command.description).toBe('Display help information for commands');
      expect(command.category).toBe('Utility');
      expect(command.aliases).toEqual(['h', '?']);
      expect(command.permissions).toEqual(['USER']);
      expect(command.options).toHaveLength(1);
      expect(command.options[0].name).toBe('command');
    });
  });

  describe('General Help', () => {
    it('should display all commands grouped by category', async () => {
      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith({
        title: 'TestBot Commands',
        description: 'Use `!tz help <command>` for more information about a specific command.',
        color: 0x2196f3,
        fields: expect.arrayContaining([
          {
            name: 'Personality Management',
            value: expect.stringContaining('`add` (create): Add a new personality'),
            inline: false,
          },
          {
            name: 'Authentication',
            value: expect.stringContaining('`auth`: Authenticate with the AI service'),
            inline: false,
          },
        ]),
      });
    });

    it('should hide admin commands for non-admin users', async () => {
      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      const embedCall = mockContext.respondWithEmbed.mock.calls[0][0];
      const adminField = embedCall.fields.find(f => f.name === 'Admin');
      expect(adminField).toBeUndefined();
    });

    it('should show admin commands for admin users', async () => {
      mockContext.isAdmin = true;

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      const embedCall = mockContext.respondWithEmbed.mock.calls[0][0];
      const adminField = embedCall.fields.find(f => f.name === 'Admin');
      expect(adminField).toBeDefined();
      expect(adminField.value).toContain('`debug`: Debug tools');
    });

    it('should hide owner commands for non-owner users', async () => {
      mockContext.isAdmin = true;
      process.env.BOT_OWNER_ID = 'owner456';

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      const embedCall = mockContext.respondWithEmbed.mock.calls[0][0];
      const adminField = embedCall.fields.find(f => f.name === 'Admin');
      expect(adminField.value).not.toContain('volumetest');
    });

    it('should show owner commands for owner', async () => {
      mockContext.userId = 'owner456';
      mockContext.isAdmin = true;
      process.env.BOT_OWNER_ID = 'owner456';

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      const embedCall = mockContext.respondWithEmbed.mock.calls[0][0];
      const ownerField = embedCall.fields.find(f => f.name === 'Owner');
      expect(ownerField.value).toContain('`volumetest`: Test volume');
    });

    it('should provide text fallback when embeds not supported', async () => {
      mockContext.respondWithEmbed = false;

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('**TestBot Commands**')
      );
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('**Personality Management**')
      );
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('• `add` (create): Add a new personality')
      );
    });
  });

  describe('Specific Command Help', () => {
    it('should show detailed help for a specific command', async () => {
      mockContext.args = ['add'];

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith({
        title: '📖 Command: add',
        description: 'Add a new personality',
        color: 0x2196f3,
        fields: expect.arrayContaining([
          {
            name: 'Usage',
            value: '`!tz add <name> [alias]`',
            inline: false,
          },
          {
            name: 'Aliases',
            value: '`create`',
            inline: false,
          },
          {
            name: 'Options',
            value: expect.stringContaining('• `name` - Personality name'),
            inline: false,
          },
        ]),
        footer: {
          text: 'Category: personality',
        },
        timestamp: expect.any(String),
      });
    });

    it('should work with command option instead of args', async () => {
      mockContext.options.command = 'list';

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith({
        title: '📖 Command: list',
        description: 'List all personalities',
        color: 0x2196f3,
        fields: expect.arrayContaining([
          {
            name: 'Usage',
            value: '`!tz list [page]`',
            inline: false,
          },
        ]),
        footer: {
          text: 'Category: personality',
        },
        timestamp: expect.any(String),
      });
    });

    it('should show unknown command message for non-existent command', async () => {
      mockContext.args = ['nonexistent'];

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith({
        title: '❌ Unknown Command',
        description: 'Command `nonexistent` not found.',
        color: 0xf44336,
        fields: [
          {
            name: 'Available Commands',
            value: 'Use `!tz help` to see all available commands.',
            inline: false,
          },
        ],
        timestamp: expect.any(String),
      });
    });

    it('should show admin restriction message for admin commands', async () => {
      mockContext.args = ['debug'];
      mockContext.isAdmin = false;

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith({
        title: '❌ Insufficient Permissions',
        description: 'This command is only available to administrators.',
        color: 0xf44336,
        timestamp: expect.any(String),
      });
    });

    it('should show command-specific detailed help', async () => {
      mockContext.args = ['auth'];

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      const embedCall = mockContext.respondWithEmbed.mock.calls[0][0];
      expect(embedCall.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Subcommands',
            value: expect.stringContaining('`start` - Begin the authentication process'),
          }),
          expect.objectContaining({
            name: 'Security Note',
            value: expect.stringContaining('authorization codes must be submitted via DM'),
          }),
        ])
      );
    });

    it('should show choices for command options', async () => {
      mockContext.args = ['auth'];

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      const embedCall = mockContext.respondWithEmbed.mock.calls[0][0];
      const optionsField = embedCall.fields.find(f => f.name === 'Options');
      expect(optionsField.value).toContain('Choices: `start`, `status`');
    });

    it('should work with command aliases', async () => {
      mockContext.args = ['create']; // Alias for 'add'

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith({
        title: '📖 Command: add',
        description: 'Add a new personality',
        color: 0x2196f3,
        fields: expect.arrayContaining([
          {
            name: 'Usage',
            value: '`!tz add <name> [alias]`',
            inline: false,
          },
        ]),
        footer: {
          text: 'Category: personality',
        },
        timestamp: expect.any(String),
      });
    });

    it('should fallback to regular embeds when respondWithEmbed not available', async () => {
      mockContext.args = ['add'];
      mockContext.respondWithEmbed = false;

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [{
          title: '📖 Command: add',
          description: 'Add a new personality',
          color: 0x2196f3,
          fields: expect.arrayContaining([
            {
              name: 'Usage',
              value: '`!tz add <name> [alias]`',
              inline: false,
            },
          ]),
          footer: {
            text: 'Category: personality',
          },
          timestamp: expect.any(String),
        }],
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle registry errors gracefully', async () => {
      mockRegistry.getAll.mockImplementation(() => {
        throw new Error('Registry error');
      });

      const command = createHelpCommand({
        commandRegistry: mockRegistry,
        botPrefix: '!tz',
        botConfig: { name: 'TestBot' },
      });

      await command.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        'An error occurred while displaying help information.'
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[HelpCommand] Execution failed:',
        expect.any(Error)
      );
    });
  });

  describe('Helper Functions', () => {
    describe('getCategoryForCommand', () => {
      it('should categorize personality commands correctly', () => {
        expect(getCategoryForCommand({ name: 'add', permissions: ['USER'] })).toBe(
          'Personality Management'
        );
        expect(getCategoryForCommand({ name: 'remove', permissions: ['USER'] })).toBe(
          'Personality Management'
        );
        expect(getCategoryForCommand({ name: 'list', permissions: ['USER'] })).toBe(
          'Personality Management'
        );
      });

      it('should categorize conversation commands correctly', () => {
        expect(getCategoryForCommand({ name: 'activate', permissions: ['USER'] })).toBe(
          'Conversation'
        );
        expect(getCategoryForCommand({ name: 'reset', permissions: ['USER'] })).toBe(
          'Conversation'
        );
      });

      it('should categorize authentication commands correctly', () => {
        expect(getCategoryForCommand({ name: 'auth', permissions: ['USER'] })).toBe(
          'Authentication'
        );
        expect(getCategoryForCommand({ name: 'verify', permissions: ['USER'] })).toBe(
          'Authentication'
        );
      });

      it('should categorize admin commands correctly', () => {
        expect(getCategoryForCommand({ name: 'debug', permissions: ['ADMIN'] })).toBe('Admin');
      });

      it('should categorize owner commands correctly', () => {
        expect(getCategoryForCommand({ name: 'volumetest', permissions: ['OWNER'] })).toBe('Owner');
      });

      it('should default to Utility for other commands', () => {
        expect(getCategoryForCommand({ name: 'ping', permissions: ['USER'] })).toBe('Utility');
        expect(getCategoryForCommand({ name: 'status', permissions: ['USER'] })).toBe('Utility');
      });
    });

    describe('getCommandSpecificHelp', () => {
      it('should provide auth command specific help', () => {
        const help = getCommandSpecificHelp('auth', '!tz');
        expect(help).toContain('**Subcommands:**');
        expect(help).toContain('`start` - Begin the authentication process');
        expect(help).toContain('**Security Note:**');
      });

      it('should provide debug command specific help', () => {
        const help = getCommandSpecificHelp('debug', '!tz');
        expect(help).toContain('`clearwebhooks` - Clear cached webhook');
      });

      it('should provide add command specific help', () => {
        const help = getCommandSpecificHelp('add', '!tz');
        expect(help).toContain('**Example:** `!tz add lilith-tzel-shani lilith`');
      });

      it('should return empty string for commands without specific help', () => {
        const help = getCommandSpecificHelp('ping', '!tz');
        expect(help).toBe('');
      });
    });
  });
});
