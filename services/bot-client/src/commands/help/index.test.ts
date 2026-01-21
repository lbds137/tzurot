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
            { type: 1, name: 'create', description: 'Create a character' },
            { type: 1, name: 'edit', description: 'Edit a character' },
          ],
        },
        execute: vi.fn(),
        category: 'Character',
      } as unknown as Command);

      commands.set('wallet', {
        data: {
          name: 'wallet',
          description: 'Manage API keys',
          options: [{ type: 1, name: 'list', description: 'List keys' }],
        },
        execute: vi.fn(),
        category: 'Wallet',
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

    it('should include personality interaction info with configured mention char', async () => {
      const commands = createMockCommands();
      const interaction = createMockContext(null, commands);

      await execute(interaction);

      const embed = mockEditReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      const interactionField = json.fields.find((f: { name: string }) =>
        f.name.includes('Personality')
      );
      expect(interactionField).toBeDefined();
      expect(interactionField?.value).toContain(`${mockConfig.BOT_MENTION_CHAR}PersonalityName`);
    });

    it('should include /character chat reference in personality interactions', async () => {
      const commands = createMockCommands();
      const interaction = createMockContext(null, commands);

      await execute(interaction);

      const embed = mockEditReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      const interactionField = json.fields.find((f: { name: string }) =>
        f.name.includes('Personality')
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
        f.name.includes('Personality')
      );
      expect(interactionField?.value).toContain('&PersonalityName');

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
        .filter((name: string) => !name.includes('Personality'));

      // Character should come before Wallet, Wallet before Help
      const characterIndex = categoryOrder.findIndex((n: string) => n.includes('Character'));
      const walletIndex = categoryOrder.findIndex((n: string) => n.includes('Wallet'));
      const helpIndex = categoryOrder.findIndex((n: string) => n.includes('Help'));

      expect(characterIndex).toBeLessThan(walletIndex);
      expect(walletIndex).toBeLessThan(helpIndex);
    });
  });
});
