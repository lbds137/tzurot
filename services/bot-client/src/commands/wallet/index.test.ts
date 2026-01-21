/**
 * Tests for Wallet Command
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import type { SafeCommandContext } from '../../utils/commandContext/types.js';

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
const { data, execute, handleModal, deferralMode, subcommandDeferralModes } = walletCommand;
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

  describe('deferral mode configuration', () => {
    it('should have ephemeral as default deferral mode', () => {
      expect(deferralMode).toBe('ephemeral');
    });

    it('should have modal deferral mode for set subcommand', () => {
      expect(subcommandDeferralModes).toBeDefined();
      expect(subcommandDeferralModes?.set).toBe('modal');
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
    function createMockContext(subcommandName: string | null): SafeCommandContext {
      const mockInteraction = {
        user: { id: '123456789' },
        options: {
          getSubcommand: () => subcommandName,
        },
      } as unknown as ChatInputCommandInteraction;

      const mockEditReply = vi.fn();
      const mockReply = vi.fn();

      return {
        interaction: mockInteraction,
        user: mockInteraction.user,
        guild: null,
        member: null,
        channel: null,
        channelId: 'channel-123',
        guildId: null,
        commandName: 'wallet',
        isEphemeral: true,
        getOption: vi.fn(),
        getRequiredOption: vi.fn(),
        getSubcommand: () => subcommandName,
        getSubcommandGroup: () => null,
        editReply: mockEditReply,
        followUp: vi.fn(),
        deleteReply: vi.fn(),
        showModal: vi.fn(),
        reply: mockReply,
        deferReply: vi.fn(),
      } as unknown as SafeCommandContext;
    }

    it('should route set subcommand to handleSetKey', async () => {
      const context = createMockContext('set');
      await execute(context);

      expect(handleSetKey).toHaveBeenCalledWith(context);
    });

    it('should route list subcommand to handleListKeys', async () => {
      const context = createMockContext('list');
      await execute(context);

      expect(handleListKeys).toHaveBeenCalledWith(context);
    });

    it('should route remove subcommand to handleRemoveKey', async () => {
      const context = createMockContext('remove');
      await execute(context);

      expect(handleRemoveKey).toHaveBeenCalledWith(context);
    });

    it('should route test subcommand to handleTestKey', async () => {
      const context = createMockContext('test');
      await execute(context);

      expect(handleTestKey).toHaveBeenCalledWith(context);
    });

    it('should reply with error for unknown subcommand', async () => {
      const context = createMockContext('unknown');
      await execute(context);

      // The mixed-mode router uses editReply for deferred contexts
      expect(context.editReply).toHaveBeenCalledWith({ content: '❌ Unknown subcommand' });
    });

    it('should handle null subcommand', async () => {
      const context = createMockContext(null);
      await execute(context);

      expect(context.editReply).toHaveBeenCalledWith({ content: '❌ No subcommand specified' });
    });
  });
});
