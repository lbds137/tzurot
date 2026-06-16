/**
 * Tests for Help Command
 *
 * This command uses deferralMode: 'ephemeral' which means:
 * - Framework calls deferReply before execute()
 * - Execute receives a SafeCommandContext (not raw interaction)
 * - Tests must mock the context, not the interaction directly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import helpCommand from './index.js';

// Destructure from default export
const { execute, data, deferralMode } = helpCommand;
import type { Command } from '../../types.js';
import type { SafeCommandContext } from '../../utils/commandContext/index.js';

// Mock common-types
const mockConfig = {
  BOT_MENTION_CHAR: '@',
};

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    getConfig: () => mockConfig,
    DISCORD_COLORS: {
      BLURPLE: 0x5865f2,
    },
  };
});

describe('Help Command', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command definition', () => {
    it('should have correct name and description', () => {
      expect(data.name).toBe('help');
      expect(data.description).toBe('Show all available commands');
    });

    it('should have optional command option', () => {
      const json = data.toJSON();
      expect(json.options).toHaveLength(1);
      expect(json.options![0].name).toBe('command');
      expect(json.options![0].required).toBe(false);
    });

    it('should have deferralMode set to ephemeral', () => {
      expect(deferralMode).toBe('ephemeral');
    });
  });

  describe('execute', () => {
    function createMockCommands(): Map<string, Command> {
      const commands = new Map<string, Command>();

      commands.set('character', {
        data: {
          name: 'character',
          description: 'Manage AI characters',
          options: [
            {
              type: 1,
              name: 'create',
              description: 'Create a character',
              options: [
                { type: 3, name: 'name', description: 'Character name', required: true },
                { type: 3, name: 'slug', description: 'URL slug', required: false },
              ],
            },
            { type: 1, name: 'edit', description: 'Edit a character' },
          ],
        },
        execute: vi.fn(),
        category: 'Character',
      } as unknown as Command);

      commands.set('settings', {
        data: {
          name: 'settings',
          description: 'Manage account settings',
          options: [{ type: 1, name: 'timezone', description: 'Manage timezone' }],
        },
        execute: vi.fn(),
        category: 'Settings',
      } as unknown as Command);

      commands.set('help', {
        data: {
          name: 'help',
          description: 'Show all available commands',
        },
        execute: vi.fn(),
        category: 'Help',
      } as unknown as Command);

      return commands;
    }

    /**
     * Create a mock SafeCommandContext for testing.
     *
     * The context wraps the interaction and provides type-safe methods.
     */
    function createMockContext(
      commandOption: string | null = null,
      commands?: Map<string, Command>
    ): SafeCommandContext {
      // Mock the underlying interaction
      const mockInteraction = {
        options: {
          getString: vi.fn(() => commandOption),
        },
        client: {
          commands: commands,
        },
      };

      // Create mock context that mirrors DeferredCommandContext
      return {
        interaction: mockInteraction,
        user: { id: 'user-123', username: 'testuser' },
        guild: null,
        member: null,
        channel: null,
        channelId: 'channel-123',
        guildId: null,
        commandName: 'help',
        isEphemeral: true,
        getOption: <T>(name: string): T | null => {
          if (name === 'command') {
            return commandOption as T | null;
          }
          return null;
        },
        getRequiredOption: vi.fn(),
        getSubcommand: () => null,
        getSubcommandGroup: () => null,
        editReply: mockEditReply,
        followUp: vi.fn(),
        deleteReply: vi.fn(),
      } as unknown as SafeCommandContext;
    }

    it('should show error when commands not provided', async () => {
      const interaction = createMockContext(null, undefined);

      await execute(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Unable to load commands'),
      });
    });

    it('should show all commands when no specific command requested', async () => {
      const commands = createMockCommands();
      const interaction = createMockContext(null, commands);

      await execute(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });

      // Verify embed content
      const embed = mockEditReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      expect(json.title).toContain('Available Commands');
      expect(json.fields).toBeDefined();
      expect(json.fields.length).toBeGreaterThan(0);
    });

    it('should show command details when specific command requested', async () => {
      const commands = createMockCommands();
      const interaction = createMockContext('character', commands);

      await execute(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });

      // Verify embed shows command details
      const embed = mockEditReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      expect(json.title).toBe('/character');
      expect(json.description).toBe('Manage AI characters');

      // Each subcommand becomes its own field, and `create`'s params are listed
      const createField = json.fields.find((f: { name: string }) => f.name.includes('create'));
      expect(createField).toBeDefined();
      expect(createField?.value).toContain('Create a character');
      expect(createField?.value).toContain('`name`');
      expect(createField?.value).toContain('*(required)*');
      expect(createField?.value).toContain('`slug`');

      // A param-less subcommand still renders a field
      const editField = json.fields.find((f: { name: string }) => f.name.includes('edit'));
      expect(editField).toBeDefined();
    });

    it('shows parameters for a flat command (no subcommands)', async () => {
      const commands = createMockCommands();
      const interaction = createMockContext('help', commands);

      // /help itself has a single `command` string option
      commands.set('help', {
        data: {
          name: 'help',
          description: 'Show all available commands',
          options: [
            { type: 3, name: 'command', description: 'Command to detail', required: false },
          ],
        },
        execute: vi.fn(),
        category: 'Help',
      } as unknown as Command);

      await execute(interaction);

      const embed = mockEditReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();
      const paramsField = json.fields?.find((f: { name: string }) => f.name === 'Parameters');
      expect(paramsField).toBeDefined();
      expect(paramsField?.value).toContain('`command`');
    });

    it('expands subcommand groups with `group sub` labels and renders group params', async () => {
      const commands = new Map<string, Command>();
      commands.set('voice', {
        data: {
          name: 'voice',
          description: 'Voice configuration',
          options: [
            {
              type: 2, // SUBCOMMAND_GROUP
              name: 'tts',
              description: 'TTS config',
              options: [
                {
                  type: 1,
                  name: 'set',
                  description: 'Override TTS for a character',
                  options: [
                    { type: 3, name: 'character', description: 'Which character', required: true },
                  ],
                },
              ],
            },
          ],
        },
        execute: vi.fn(),
        category: 'Voice',
      } as unknown as Command);
      const interaction = createMockContext('voice', commands);

      await execute(interaction);

      const json = mockEditReply.mock.calls[0][0].embeds[0].toJSON();
      const groupField = json.fields.find((f: { name: string }) => f.name.includes('tts set'));
      expect(groupField).toBeDefined();
      expect(groupField?.value).toContain('Override TTS for a character');
      expect(groupField?.value).toContain('`character`');
      expect(groupField?.value).toContain('*(required)*');
    });

    it('renders the no-parameters fallback when a subcommand has neither description nor params', async () => {
      const commands = new Map<string, Command>();
      commands.set('bare', {
        data: {
          name: 'bare',
          description: 'Bare command',
          // A subcommand with an empty description and no options exercises the
          // `_No parameters._` fallback (Discord normally requires a description,
          // so this is the defensive empty-value guard).
          options: [{ type: 1, name: 'noop', description: '' }],
        },
        execute: vi.fn(),
        category: 'Other',
      } as unknown as Command);
      const interaction = createMockContext('bare', commands);

      await execute(interaction);

      const json = mockEditReply.mock.calls[0][0].embeds[0].toJSON();
      const field = json.fields.find((f: { name: string }) => f.name.includes('noop'));
      expect(field?.value).toContain('No parameters');
    });

    it('caps subcommand fields at the Discord limit with an overflow note', async () => {
      const manySubs = Array.from({ length: 30 }, (_, i) => ({
        type: 1,
        name: `sub${i}`,
        description: `Subcommand ${i}`,
      }));
      const commands = new Map<string, Command>();
      commands.set('big', {
        data: { name: 'big', description: 'Many subcommands', options: manySubs },
        execute: vi.fn(),
        category: 'Other',
      } as unknown as Command);
      const interaction = createMockContext('big', commands);

      await execute(interaction);

      const json = mockEditReply.mock.calls[0][0].embeds[0].toJSON();
      // 24 subcommand fields + 1 overflow note = Discord's 25-field cap
      expect(json.fields).toHaveLength(25);
      const overflow = json.fields.find((f: { name: string }) => f.name.includes('and more'));
      expect(overflow).toBeDefined();
      expect(overflow?.value).toContain('6 more'); // 30 - 24
    });

    it('should show error for unknown command', async () => {
      const commands = createMockCommands();
      const interaction = createMockContext('nonexistent', commands);

      await execute(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Unknown command'),
      });
    });

    it('should include subcommand count hints', async () => {
      const commands = createMockCommands();
      const interaction = createMockContext(null, commands);

      await execute(interaction);

      const embed = mockEditReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      // Character command has 2 subcommands
      const characterField = json.fields.find((f: { name: string }) =>
        f.name.includes('Character')
      );
      expect(characterField?.value).toContain('2 subcommands');
    });

    it('should include character interaction info with configured mention char', async () => {
      const commands = createMockCommands();
      const interaction = createMockContext(null, commands);

      await execute(interaction);

      const embed = mockEditReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      const interactionField = json.fields.find((f: { name: string }) =>
        f.name.includes('Interactions')
      );
      expect(interactionField).toBeDefined();
      expect(interactionField?.value).toContain(`${mockConfig.BOT_MENTION_CHAR}CharacterName`);
    });

    it('should include /character chat reference in character interactions', async () => {
      const commands = createMockCommands();
      const interaction = createMockContext(null, commands);

      await execute(interaction);

      const embed = mockEditReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      const interactionField = json.fields.find((f: { name: string }) =>
        f.name.includes('Interactions')
      );
      expect(interactionField?.value).toContain('/character chat');
    });

    it('should use custom mention char from config', async () => {
      // Change mention char to dev mode
      mockConfig.BOT_MENTION_CHAR = '&';

      const commands = createMockCommands();
      const interaction = createMockContext(null, commands);

      await execute(interaction);

      const embed = mockEditReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      const interactionField = json.fields.find((f: { name: string }) =>
        f.name.includes('Interactions')
      );
      expect(interactionField?.value).toContain('&CharacterName');

      // Reset to default
      mockConfig.BOT_MENTION_CHAR = '@';
    });

    it('should sort categories by configured order', async () => {
      const commands = createMockCommands();
      const interaction = createMockContext(null, commands);

      await execute(interaction);

      const embed = mockEditReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      // Get category names (stripping emojis)
      const categoryOrder = json.fields
        .map((f: { name: string }) => f.name)
        .filter((name: string) => !name.includes('Interactions'));

      // Character should come before Settings, Settings before Help
      const characterIndex = categoryOrder.findIndex((n: string) => n.includes('Character'));
      const settingsIndex = categoryOrder.findIndex((n: string) => n.includes('Settings'));
      const helpIndex = categoryOrder.findIndex((n: string) => n.includes('Help'));

      expect(characterIndex).toBeLessThan(settingsIndex);
      expect(settingsIndex).toBeLessThan(helpIndex);
    });
  });
});
