/**
 * Tests for Utility Command Router
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { data, execute } from './index.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../types.js';

// Mock common-types
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock subcommand handlers
vi.mock('./ping.js', () => ({
  handlePing: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./help.js', () => ({
  handleHelp: vi.fn().mockResolvedValue(undefined),
}));

import { handlePing } from './ping.js';
import { handleHelp } from './help.js';

describe('utility command', () => {
  describe('data (SlashCommandBuilder)', () => {
    it('should have correct command name and description', () => {
      expect(data.name).toBe('utility');
      expect(data.description).toBe('Utility commands');
    });

    it('should have ping subcommand', () => {
      const options = data.options ?? [];
      const pingSubcommand = options.find(opt => 'name' in opt && opt.name === 'ping');

      expect(pingSubcommand).toBeDefined();
      if (pingSubcommand && 'name' in pingSubcommand && 'description' in pingSubcommand) {
        expect(pingSubcommand.name).toBe('ping');
        expect(pingSubcommand.description).toBe('Check if bot is responding');
      }
    });

    it('should have help subcommand', () => {
      const options = data.options ?? [];
      const helpSubcommand = options.find(opt => 'name' in opt && opt.name === 'help');

      expect(helpSubcommand).toBeDefined();
      if (helpSubcommand && 'name' in helpSubcommand && 'description' in helpSubcommand) {
        expect(helpSubcommand.name).toBe('help');
        expect(helpSubcommand.description).toBe('Show all available commands');
      }
    });
  });

  describe('execute (router)', () => {
    let mockInteraction: ChatInputCommandInteraction;
    const mockCommands = new Map<string, Command>();

    beforeEach(() => {
      vi.clearAllMocks();

      mockInteraction = {
        user: { id: 'test-user-id' },
        options: {
          getSubcommand: vi.fn(),
        },
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatInputCommandInteraction;
    });

    it('should route to handlePing for ping subcommand', async () => {
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('ping');

      await execute(mockInteraction);

      expect(handlePing).toHaveBeenCalledWith(mockInteraction);
      expect(handleHelp).not.toHaveBeenCalled();
    });

    it('should route to handleHelp for help subcommand', async () => {
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('help');

      await execute(mockInteraction, mockCommands);

      expect(handleHelp).toHaveBeenCalledWith(mockInteraction, mockCommands);
      expect(handlePing).not.toHaveBeenCalled();
    });

    it('should pass commands map to help handler', async () => {
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('help');

      const commands = new Map<string, Command>();
      commands.set('test', {
        data: { name: 'test', description: 'Test' },
        execute: vi.fn(),
      });

      await execute(mockInteraction, commands);

      expect(handleHelp).toHaveBeenCalledWith(mockInteraction, commands);
    });

    it('should handle unknown subcommand', async () => {
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('unknown');

      await execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
      expect(handlePing).not.toHaveBeenCalled();
      expect(handleHelp).not.toHaveBeenCalled();
    });

    it('should work without commands map for ping subcommand', async () => {
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('ping');

      await execute(mockInteraction);

      expect(handlePing).toHaveBeenCalledWith(mockInteraction);
    });
  });
});
