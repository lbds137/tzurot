/**
 * Tests for Wallet Command
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { AIProvider } from '@tzurot/common-types';

// Mock dependencies
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
    getConfig: () => ({
      GATEWAY_URL: 'http://localhost:3000',
    }),
  };
});

// Mock subcommand handlers
vi.mock('./set.js', () => ({
  handleSetKey: vi.fn(),
}));

vi.mock('./list.js', () => ({
  handleListKeys: vi.fn(),
}));

vi.mock('./remove.js', () => ({
  handleRemoveKey: vi.fn(),
}));

vi.mock('./test.js', () => ({
  handleTestKey: vi.fn(),
}));

vi.mock('./modal.js', () => ({
  handleWalletModalSubmit: vi.fn(),
}));

import walletCommand from './index.js';

// Destructure from default export
const { data, execute, handleModal } = walletCommand;
import { handleSetKey } from './set.js';
import { handleListKeys } from './list.js';
import { handleRemoveKey } from './remove.js';
import { handleTestKey } from './test.js';
import { handleWalletModalSubmit } from './modal.js';

describe('Wallet Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('data (command definition)', () => {
    it('should have correct command name', () => {
      expect(data.name).toBe('wallet');
    });

    it('should have description', () => {
      expect(data.description).toContain('API keys');
    });

    it('should have set subcommand with provider option', () => {
      const jsonData = data.toJSON();
      const subcommands = jsonData.options?.filter((opt: { type: number }) => opt.type === 1) ?? [];
      const setSubcommand = subcommands.find((sub: { name: string }) => sub.name === 'set');

      expect(setSubcommand).toBeDefined();
      expect(setSubcommand.options).toHaveLength(1);
      expect(setSubcommand.options[0].name).toBe('provider');
      expect(setSubcommand.options[0].required).toBe(true);
    });

    it('should have list subcommand', () => {
      const jsonData = data.toJSON();
      const subcommands = jsonData.options?.filter((opt: { type: number }) => opt.type === 1) ?? [];
      const listSubcommand = subcommands.find((sub: { name: string }) => sub.name === 'list');

      expect(listSubcommand).toBeDefined();
    });

    it('should have remove subcommand with provider option', () => {
      const jsonData = data.toJSON();
      const subcommands = jsonData.options?.filter((opt: { type: number }) => opt.type === 1) ?? [];
      const removeSubcommand = subcommands.find((sub: { name: string }) => sub.name === 'remove');

      expect(removeSubcommand).toBeDefined();
      expect(removeSubcommand.options).toHaveLength(1);
      expect(removeSubcommand.options[0].name).toBe('provider');
    });

    it('should have test subcommand with provider option', () => {
      const jsonData = data.toJSON();
      const subcommands = jsonData.options?.filter((opt: { type: number }) => opt.type === 1) ?? [];
      const testSubcommand = subcommands.find((sub: { name: string }) => sub.name === 'test');

      expect(testSubcommand).toBeDefined();
      expect(testSubcommand.options).toHaveLength(1);
      expect(testSubcommand.options[0].name).toBe('provider');
    });
  });

  describe('handleModal', () => {
    it('should route modal submissions to handleWalletModalSubmit', async () => {
      const mockModalInteraction = {
        customId: 'wallet::set::openrouter',
      } as unknown as ModalSubmitInteraction;

      await handleModal(mockModalInteraction);

      expect(handleWalletModalSubmit).toHaveBeenCalledWith(mockModalInteraction);
    });
  });

  describe('execute', () => {
    it('should route set subcommand to handleSetKey', async () => {
      const mockInteraction = {
        options: {
          getSubcommand: () => 'set',
        },
        user: { id: '123456789' },
      } as unknown as ChatInputCommandInteraction;

      await execute(mockInteraction);

      expect(handleSetKey).toHaveBeenCalledWith(mockInteraction);
    });

    it('should route list subcommand to handleListKeys', async () => {
      const mockInteraction = {
        options: {
          getSubcommand: () => 'list',
        },
        user: { id: '123456789' },
      } as unknown as ChatInputCommandInteraction;

      await execute(mockInteraction);

      expect(handleListKeys).toHaveBeenCalledWith(mockInteraction);
    });

    it('should route remove subcommand to handleRemoveKey', async () => {
      const mockInteraction = {
        options: {
          getSubcommand: () => 'remove',
        },
        user: { id: '123456789' },
      } as unknown as ChatInputCommandInteraction;

      await execute(mockInteraction);

      expect(handleRemoveKey).toHaveBeenCalledWith(mockInteraction);
    });

    it('should route test subcommand to handleTestKey', async () => {
      const mockInteraction = {
        options: {
          getSubcommand: () => 'test',
        },
        user: { id: '123456789' },
      } as unknown as ChatInputCommandInteraction;

      await execute(mockInteraction);

      expect(handleTestKey).toHaveBeenCalledWith(mockInteraction);
    });

    it('should reply with error for unknown subcommand', async () => {
      const mockReply = vi.fn();
      const mockInteraction = {
        options: {
          getSubcommand: () => 'unknown',
        },
        user: { id: '123456789' },
        reply: mockReply,
      } as unknown as ChatInputCommandInteraction;

      await execute(mockInteraction);

      expect(mockReply).toHaveBeenCalledWith({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
    });
  });
});
