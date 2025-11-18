/**
 * Tests for Admin Command Router
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { data, execute } from './index.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';

// Mock requireBotOwner middleware
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    requireBotOwner: vi.fn(),
    getConfig: vi.fn(() => ({
      GATEWAY_URL: 'http://localhost:3000',
    })),
  };
});

// Mock subcommand handlers
vi.mock('./db-sync.js', () => ({
  handleDbSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./servers.js', () => ({
  handleServers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./kick.js', () => ({
  handleKick: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./usage.js', () => ({
  handleUsage: vi.fn().mockResolvedValue(undefined),
}));

import { requireBotOwner, getConfig } from '@tzurot/common-types';
import { handleDbSync } from './db-sync.js';
import { handleServers } from './servers.js';
import { handleKick } from './kick.js';
import { handleUsage } from './usage.js';

describe('admin command', () => {
  describe('data (SlashCommandBuilder)', () => {
    it('should have correct command name and description', () => {
      expect(data.name).toBe('admin');
      expect(data.description).toBe('Admin commands (Owner only)');
    });

    it('should have db-sync subcommand', () => {
      const options = data.options ?? [];
      const dbSyncSubcommand = options.find(
        opt => 'name' in opt && opt.name === 'db-sync'
      );

      expect(dbSyncSubcommand).toBeDefined();
      if (dbSyncSubcommand && 'name' in dbSyncSubcommand && 'description' in dbSyncSubcommand) {
        expect(dbSyncSubcommand.name).toBe('db-sync');
        expect(dbSyncSubcommand.description).toBe('Trigger database synchronization');
      }
    });

    it('should have servers subcommand', () => {
      const options = data.options ?? [];
      const serversSubcommand = options.find(
        opt => 'name' in opt && opt.name === 'servers'
      );

      expect(serversSubcommand).toBeDefined();
      if (serversSubcommand && 'name' in serversSubcommand && 'description' in serversSubcommand) {
        expect(serversSubcommand.name).toBe('servers');
        expect(serversSubcommand.description).toBe('List all servers the bot is in');
      }
    });

    it('should have kick subcommand', () => {
      const options = data.options ?? [];
      const kickSubcommand = options.find(
        opt => 'name' in opt && opt.name === 'kick'
      );

      expect(kickSubcommand).toBeDefined();
      if (kickSubcommand && 'name' in kickSubcommand && 'description' in kickSubcommand) {
        expect(kickSubcommand.name).toBe('kick');
        expect(kickSubcommand.description).toBe('Remove the bot from a server');
      }
    });

    it('should have usage subcommand', () => {
      const options = data.options ?? [];
      const usageSubcommand = options.find(
        opt => 'name' in opt && opt.name === 'usage'
      );

      expect(usageSubcommand).toBeDefined();
      if (usageSubcommand && 'name' in usageSubcommand && 'description' in usageSubcommand) {
        expect(usageSubcommand.name).toBe('usage');
        expect(usageSubcommand.description).toBe('View API usage statistics');
      }
    });
  });

  describe('execute (router)', () => {
    let mockInteraction: ChatInputCommandInteraction;

    beforeEach(() => {
      vi.clearAllMocks();

      mockInteraction = {
        options: {
          getSubcommand: vi.fn(),
        },
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatInputCommandInteraction;
    });

    it('should check owner permission before executing', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(false);

      await execute(mockInteraction);

      expect(requireBotOwner).toHaveBeenCalledWith(mockInteraction);
      // Should not call any handlers
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route to handleDbSync for db-sync subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('db-sync');

      await execute(mockInteraction);

      const config = getConfig();
      expect(handleDbSync).toHaveBeenCalledWith(mockInteraction, config);
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route to handleServers for servers subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('servers');

      await execute(mockInteraction);

      expect(handleServers).toHaveBeenCalledWith(mockInteraction);
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route to handleKick for kick subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('kick');

      await execute(mockInteraction);

      expect(handleKick).toHaveBeenCalledWith(mockInteraction);
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should route to handleUsage for usage subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('usage');

      await execute(mockInteraction);

      const config = getConfig();
      expect(handleUsage).toHaveBeenCalledWith(mockInteraction, config);
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
    });

    it('should handle unknown subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('unknown');

      await execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
      expect(handleDbSync).not.toHaveBeenCalled();
      expect(handleServers).not.toHaveBeenCalled();
      expect(handleKick).not.toHaveBeenCalled();
      expect(handleUsage).not.toHaveBeenCalled();
    });

    it('should pass config to handlers that need it', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('db-sync');

      await execute(mockInteraction);

      const config = getConfig();
      expect(handleDbSync).toHaveBeenCalledWith(mockInteraction, config);
      expect(config).toBeDefined();
      expect(config.GATEWAY_URL).toBe('http://localhost:3000');
    });
  });
});
