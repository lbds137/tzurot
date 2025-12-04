/**
 * Tests for Help Command
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags, EmbedBuilder } from 'discord.js';
import { execute, data } from './index.js';
import type { Command } from '../../types.js';

// Mock common-types
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
    DISCORD_COLORS: {
      BLURPLE: 0x5865f2,
    },
  };
});

describe('Help Command', () => {
  const mockReply = vi.fn();

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
  });

  describe('execute', () => {
    function createMockInteraction(commandOption: string | null = null) {
      return {
        options: {
          getString: vi.fn(() => commandOption),
        },
        reply: mockReply,
      } as unknown as Parameters<typeof execute>[0];
    }

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

    it('should show error when commands not provided', async () => {
      const interaction = createMockInteraction();

      await execute(interaction, undefined);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Unable to load commands'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should show all commands when no specific command requested', async () => {
      const interaction = createMockInteraction(null);
      const commands = createMockCommands();

      await execute(interaction, commands);

      expect(mockReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
        flags: MessageFlags.Ephemeral,
      });

      // Verify embed content
      const embed = mockReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      expect(json.title).toContain('Available Commands');
      expect(json.fields).toBeDefined();
      expect(json.fields.length).toBeGreaterThan(0);
    });

    it('should show command details when specific command requested', async () => {
      const interaction = createMockInteraction('character');
      const commands = createMockCommands();

      await execute(interaction, commands);

      expect(mockReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
        flags: MessageFlags.Ephemeral,
      });

      // Verify embed shows command details
      const embed = mockReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      expect(json.title).toBe('/character');
      expect(json.description).toBe('Manage AI characters');
    });

    it('should show error for unknown command', async () => {
      const interaction = createMockInteraction('nonexistent');
      const commands = createMockCommands();

      await execute(interaction, commands);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Unknown command'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should include subcommand count hints', async () => {
      const interaction = createMockInteraction(null);
      const commands = createMockCommands();

      await execute(interaction, commands);

      const embed = mockReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      // Character command has 2 subcommands
      const characterField = json.fields.find((f: { name: string }) =>
        f.name.includes('Character')
      );
      expect(characterField?.value).toContain('2 subcommands');
    });

    it('should include personality interaction info', async () => {
      const interaction = createMockInteraction(null);
      const commands = createMockCommands();

      await execute(interaction, commands);

      const embed = mockReply.mock.calls[0][0].embeds[0];
      const json = embed.toJSON();

      const interactionField = json.fields.find((f: { name: string }) =>
        f.name.includes('Personality')
      );
      expect(interactionField).toBeDefined();
      expect(interactionField?.value).toContain('@PersonalityName');
    });

    it('should sort categories by configured order', async () => {
      const interaction = createMockInteraction(null);
      const commands = createMockCommands();

      await execute(interaction, commands);

      const embed = mockReply.mock.calls[0][0].embeds[0];
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
