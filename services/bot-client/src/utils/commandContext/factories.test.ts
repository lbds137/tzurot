/**
 * Tests for Command Context Factories
 *
 * Verifies that factory functions create properly typed context objects
 * with the correct methods exposed and properties set.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import {
  createDeferredContext,
  createModalContext,
  createManualContext,
  requireBotOwnerContext,
} from './factories.js';
import type { DeferredCommandContext } from './types.js';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    getConfig: vi.fn(() => ({ BOT_OWNER_ID: 'owner-123' })),
    isBotOwner: vi.fn((id: string) => id === 'owner-123'),
  };
});

import { getConfig, isBotOwner } from '@tzurot/common-types';

// Mock Discord.js interaction
function createMockInteraction(): ChatInputCommandInteraction {
  return {
    user: { id: 'user-123', username: 'testuser' },
    guild: { id: 'guild-123', name: 'Test Guild' },
    member: { id: 'member-123' } as GuildMember,
    channel: { id: 'channel-123' },
    channelId: 'channel-123',
    guildId: 'guild-123',
    commandName: 'testcommand',
    options: {
      get: vi.fn().mockReturnValue({ value: 'test-value' }),
      getSubcommand: vi.fn().mockReturnValue('subcommand'),
      getSubcommandGroup: vi.fn().mockReturnValue('group'),
    },
    editReply: vi.fn().mockResolvedValue({ id: 'msg-123' }),
    followUp: vi.fn().mockResolvedValue({ id: 'msg-456' }),
    deleteReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ id: 'response-123' }),
    deferReply: vi.fn().mockResolvedValue({ id: 'response-456' }),
    showModal: vi.fn().mockResolvedValue({ id: 'callback-123' }),
  } as unknown as ChatInputCommandInteraction;
}

describe('createDeferredContext', () => {
  let mockInteraction: ChatInputCommandInteraction;

  beforeEach(() => {
    mockInteraction = createMockInteraction();
  });

  it('should create context with base properties', () => {
    const context = createDeferredContext(mockInteraction, true);

    expect(context.interaction).toBe(mockInteraction);
    expect(context.user).toBe(mockInteraction.user);
    expect(context.guild).toBe(mockInteraction.guild);
    expect(context.member).toBe(mockInteraction.member);
    expect(context.channel).toBe(mockInteraction.channel);
    expect(context.channelId).toBe('channel-123');
    expect(context.guildId).toBe('guild-123');
    expect(context.commandName).toBe('testcommand');
  });

  it('should set isEphemeral to true when specified', () => {
    const context = createDeferredContext(mockInteraction, true);
    expect(context.isEphemeral).toBe(true);
  });

  it('should set isEphemeral to false when specified', () => {
    const context = createDeferredContext(mockInteraction, false);
    expect(context.isEphemeral).toBe(false);
  });

  it('should expose editReply method', async () => {
    const context = createDeferredContext(mockInteraction, true);
    await context.editReply('test message');

    expect(mockInteraction.editReply).toHaveBeenCalledWith('test message');
  });

  it('should expose followUp method', async () => {
    const context = createDeferredContext(mockInteraction, true);
    await context.followUp('follow up message');

    expect(mockInteraction.followUp).toHaveBeenCalledWith('follow up message');
  });

  it('should expose deleteReply method', async () => {
    const context = createDeferredContext(mockInteraction, true);
    await context.deleteReply();

    expect(mockInteraction.deleteReply).toHaveBeenCalled();
  });

  it('should NOT expose deferReply method', () => {
    const context = createDeferredContext(mockInteraction, true);

    // TypeScript should prevent this, but let's verify at runtime too
    expect((context as unknown as Record<string, unknown>).deferReply).toBeUndefined();
  });

  it('should NOT expose reply method', () => {
    const context = createDeferredContext(mockInteraction, true);
    expect((context as unknown as Record<string, unknown>).reply).toBeUndefined();
  });

  it('should NOT expose showModal method', () => {
    const context = createDeferredContext(mockInteraction, true);
    expect((context as unknown as Record<string, unknown>).showModal).toBeUndefined();
  });

  describe('getOption', () => {
    it('should return option value when present', () => {
      const context = createDeferredContext(mockInteraction, true);
      const value = context.getOption<string>('test-option');

      expect(mockInteraction.options.get).toHaveBeenCalledWith('test-option');
      expect(value).toBe('test-value');
    });

    it('should return null when option not present', () => {
      vi.mocked(mockInteraction.options.get).mockReturnValueOnce(null);
      const context = createDeferredContext(mockInteraction, true);
      const value = context.getOption<string>('missing');

      expect(value).toBeNull();
    });
  });

  describe('getRequiredOption', () => {
    it('should return option value', () => {
      vi.mocked(mockInteraction.options.get).mockReturnValueOnce({ value: 'required-value' });
      const context = createDeferredContext(mockInteraction, true);
      const value = context.getRequiredOption<string>('test-option');

      expect(mockInteraction.options.get).toHaveBeenCalledWith('test-option', true);
      expect(value).toBe('required-value');
    });
  });

  describe('getSubcommand', () => {
    it('should return subcommand when present', () => {
      const context = createDeferredContext(mockInteraction, true);
      const subcommand = context.getSubcommand();

      expect(subcommand).toBe('subcommand');
    });

    it('should return null when getSubcommand throws', () => {
      vi.mocked(mockInteraction.options.getSubcommand).mockImplementationOnce(() => {
        throw new Error('No subcommand');
      });
      const context = createDeferredContext(mockInteraction, true);
      const subcommand = context.getSubcommand();

      expect(subcommand).toBeNull();
    });
  });

  describe('getSubcommandGroup', () => {
    it('should return subcommand group when present', () => {
      const context = createDeferredContext(mockInteraction, true);
      const group = context.getSubcommandGroup();

      expect(group).toBe('group');
    });

    it('should return null when getSubcommandGroup throws', () => {
      vi.mocked(mockInteraction.options.getSubcommandGroup).mockImplementationOnce(() => {
        throw new Error('No subcommand group');
      });
      const context = createDeferredContext(mockInteraction, true);
      const group = context.getSubcommandGroup();

      expect(group).toBeNull();
    });
  });
});

describe('createModalContext', () => {
  let mockInteraction: ChatInputCommandInteraction;

  beforeEach(() => {
    mockInteraction = createMockInteraction();
  });

  it('should create context with base properties', () => {
    const context = createModalContext(mockInteraction);

    expect(context.interaction).toBe(mockInteraction);
    expect(context.user).toBe(mockInteraction.user);
    expect(context.commandName).toBe('testcommand');
  });

  it('should expose showModal method', async () => {
    const context = createModalContext(mockInteraction);
    const mockModal = { toJSON: vi.fn() };
    await context.showModal(mockModal as unknown as Parameters<typeof context.showModal>[0]);

    expect(mockInteraction.showModal).toHaveBeenCalledWith(mockModal);
  });

  it('should expose reply method', async () => {
    const context = createModalContext(mockInteraction);
    await context.reply('error message');

    expect(mockInteraction.reply).toHaveBeenCalledWith('error message');
  });

  it('should expose deferReply method', async () => {
    const context = createModalContext(mockInteraction);
    await context.deferReply({ ephemeral: true });

    expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  });

  it('should NOT expose editReply method', () => {
    const context = createModalContext(mockInteraction);
    expect((context as unknown as Record<string, unknown>).editReply).toBeUndefined();
  });
});

describe('createManualContext', () => {
  let mockInteraction: ChatInputCommandInteraction;

  beforeEach(() => {
    mockInteraction = createMockInteraction();
  });

  it('should create context with base properties', () => {
    const context = createManualContext(mockInteraction);

    expect(context.interaction).toBe(mockInteraction);
    expect(context.user).toBe(mockInteraction.user);
    expect(context.commandName).toBe('testcommand');
  });

  it('should expose all response methods', async () => {
    const context = createManualContext(mockInteraction);

    await context.reply('test');
    expect(mockInteraction.reply).toHaveBeenCalledWith('test');

    await context.deferReply({ ephemeral: true });
    expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });

    await context.editReply('updated');
    expect(mockInteraction.editReply).toHaveBeenCalledWith('updated');

    const mockModal = { toJSON: vi.fn() };
    await context.showModal(mockModal as unknown as Parameters<typeof context.showModal>[0]);
    expect(mockInteraction.showModal).toHaveBeenCalledWith(mockModal);
  });
});

describe('Type Safety (compile-time verified)', () => {
  it('should document that DeferredCommandContext lacks deferReply', () => {
    /**
     * This test documents the compile-time safety.
     *
     * If you uncomment the following code, TypeScript will produce an error:
     *
     * const context = createDeferredContext(mockInteraction, true);
     * context.deferReply(); // Error: Property 'deferReply' does not exist
     *
     * This is the key safety feature - commands can't accidentally call
     * deferReply() after it's already been called by the framework.
     */
    expect(true).toBe(true);
  });
});

describe('requireBotOwnerContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(userId: string = 'owner-123'): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: {} as ChatInputCommandInteraction,
      user: { id: userId },
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'admin',
      isEphemeral: true,
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue(null),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  it('should return true for bot owner', async () => {
    const context = createMockContext('owner-123');

    const result = await requireBotOwnerContext(context);

    expect(result).toBe(true);
    expect(context.editReply).not.toHaveBeenCalled();
  });

  it('should return false and show error for non-owner', async () => {
    vi.mocked(isBotOwner).mockReturnValueOnce(false);
    const context = createMockContext('user-456');

    const result = await requireBotOwnerContext(context);

    expect(result).toBe(false);
    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Owner-only command. This command is restricted to the bot owner.',
    });
  });

  it('should return false and show error when BOT_OWNER_ID not configured', async () => {
    vi.mocked(getConfig).mockReturnValueOnce({} as ReturnType<typeof getConfig>);
    const context = createMockContext('any-user');

    const result = await requireBotOwnerContext(context);

    expect(result).toBe(false);
    expect(context.editReply).toHaveBeenCalledWith({
      content: '⚠️ Bot owner not configured. Please set BOT_OWNER_ID environment variable.',
    });
  });

  it('should return false when BOT_OWNER_ID is empty string', async () => {
    vi.mocked(getConfig).mockReturnValueOnce({ BOT_OWNER_ID: '' } as ReturnType<typeof getConfig>);
    const context = createMockContext('any-user');

    const result = await requireBotOwnerContext(context);

    expect(result).toBe(false);
    expect(context.editReply).toHaveBeenCalledWith({
      content: '⚠️ Bot owner not configured. Please set BOT_OWNER_ID environment variable.',
    });
  });
});
