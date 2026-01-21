/**
 * Test Utilities for Command Contexts
 *
 * Provides mock factory functions for creating typed command contexts in tests.
 * These utilities reduce boilerplate and ensure consistent mock structure.
 *
 * @example
 * ```typescript
 * import { createMockDeferredContext } from '../../utils/commandContext/testUtils.js';
 *
 * it('should handle the command', async () => {
 *   const ctx = createMockDeferredContext({
 *     user: { id: 'user-123' },
 *     options: { personality: 'test-personality' },
 *   });
 *
 *   await handleCommand(ctx);
 *
 *   expect(ctx.editReply).toHaveBeenCalledWith('Success!');
 * });
 * ```
 */

import { vi } from 'vitest';
import type { ChatInputCommandInteraction, User, Guild, GuildMember } from 'discord.js';
import type { DeferredCommandContext, ModalCommandContext, ManualCommandContext } from './types.js';

/**
 * Options for creating mock contexts
 */
export interface MockContextOptions {
  /** User ID (defaults to 'user-123') */
  userId?: string;
  /** Guild ID (defaults to 'guild-123', null for DMs) */
  guildId?: string | null;
  /** Channel ID (defaults to 'channel-123') */
  channelId?: string;
  /** Command name (defaults to 'test-command') */
  commandName?: string;
  /** Subcommand name (defaults to null) */
  subcommand?: string | null;
  /** Subcommand group (defaults to null) */
  subcommandGroup?: string | null;
  /** Option values keyed by name */
  options?: Record<string, unknown>;
  /** Whether the reply is ephemeral (for DeferredCommandContext) */
  isEphemeral?: boolean;
}

/**
 * Creates a mock User object
 */
function createMockUser(id: string): User {
  return {
    id,
    username: `user-${id}`,
    discriminator: '0',
    bot: false,
    tag: `user-${id}#0`,
  } as User;
}

/**
 * Creates a mock Guild object
 */
function createMockGuild(id: string): Guild {
  return {
    id,
    name: `Guild ${id}`,
  } as Guild;
}

/**
 * Base mock context properties returned by createBaseContextMock
 */
interface BaseContextMock {
  interaction: ChatInputCommandInteraction;
  user: User;
  guild: Guild | null;
  member: GuildMember | null;
  channel: { id: string } | null;
  channelId: string;
  guildId: string | null | undefined;
  commandName: string;
  getOption: ReturnType<typeof vi.fn>;
  getRequiredOption: ReturnType<typeof vi.fn>;
  getSubcommand: ReturnType<typeof vi.fn>;
  getSubcommandGroup: ReturnType<typeof vi.fn>;
}

/**
 * Creates the base context properties shared by all context types
 */
function createBaseContextMock(opts: MockContextOptions): BaseContextMock {
  const userId = opts.userId ?? 'user-123';
  // Use 'guildId' in opts check to allow explicit null (for DMs)
  const guildId = 'guildId' in opts ? opts.guildId : 'guild-123';
  const channelId = opts.channelId ?? 'channel-123';
  const commandName = opts.commandName ?? 'test-command';
  const subcommand = opts.subcommand ?? null;
  const subcommandGroup = opts.subcommandGroup ?? null;
  const options = opts.options ?? {};

  // Check if guildId is a valid string (not null or undefined)
  const hasGuild = typeof guildId === 'string';

  const mockInteraction = {
    user: createMockUser(userId),
    guild: hasGuild ? createMockGuild(guildId) : null,
    member: hasGuild ? ({ id: userId } as GuildMember) : null,
    channel: { id: channelId },
    channelId,
    guildId,
    commandName,
    options: {
      get: vi.fn((name: string) => {
        const value = options[name];
        return value !== undefined ? { value } : null;
      }),
      getSubcommand: vi.fn(() => subcommand),
      getSubcommandGroup: vi.fn(() => subcommandGroup),
    },
  } as unknown as ChatInputCommandInteraction;

  return {
    interaction: mockInteraction,
    user: mockInteraction.user,
    guild: mockInteraction.guild,
    member: mockInteraction.member as GuildMember | null,
    channel: mockInteraction.channel,
    channelId,
    guildId: guildId,
    commandName,
    getOption: vi.fn(<T = unknown>(name: string): T | null => {
      const value = options[name];
      return value !== undefined ? (value as T) : null;
    }),
    getRequiredOption: vi.fn(<T = unknown>(name: string): T => {
      const value = options[name];
      if (value === undefined) {
        throw new Error(`Required option '${name}' not provided`);
      }
      return value as T;
    }),
    getSubcommand: vi.fn(() => subcommand),
    getSubcommandGroup: vi.fn(() => subcommandGroup),
  };
}

/**
 * Creates a mock DeferredCommandContext for testing deferred command handlers.
 *
 * @example
 * ```typescript
 * const ctx = createMockDeferredContext({
 *   userId: 'user-456',
 *   options: { name: 'test' },
 * });
 *
 * await handleList(ctx);
 *
 * expect(ctx.editReply).toHaveBeenCalled();
 * ```
 */
export function createMockDeferredContext(
  opts: MockContextOptions = {}
): DeferredCommandContext & { editReply: ReturnType<typeof vi.fn> } {
  const base = createBaseContextMock(opts);

  return {
    ...base,
    isEphemeral: opts.isEphemeral ?? true,
    editReply: vi.fn().mockResolvedValue({ id: 'msg-123' }),
    followUp: vi.fn().mockResolvedValue({ id: 'msg-456' }),
    deleteReply: vi.fn().mockResolvedValue(undefined),
  } as DeferredCommandContext & { editReply: ReturnType<typeof vi.fn> };
}

/**
 * Creates a mock ModalCommandContext for testing modal command handlers.
 *
 * @example
 * ```typescript
 * const ctx = createMockModalContext();
 *
 * await handleCreate(ctx);
 *
 * expect(ctx.showModal).toHaveBeenCalled();
 * ```
 */
export function createMockModalContext(
  opts: MockContextOptions = {}
): ModalCommandContext & { showModal: ReturnType<typeof vi.fn> } {
  const base = createBaseContextMock(opts);

  return {
    ...base,
    showModal: vi.fn().mockResolvedValue({ id: 'callback-123' }),
    reply: vi.fn().mockResolvedValue({ id: 'response-123' }),
    deferReply: vi.fn().mockResolvedValue({ id: 'response-456' }),
  } as ModalCommandContext & { showModal: ReturnType<typeof vi.fn> };
}

/**
 * Creates a mock ManualCommandContext for testing manual command handlers.
 *
 * @example
 * ```typescript
 * const ctx = createMockManualContext();
 *
 * await handleSpecialCommand(ctx);
 *
 * expect(ctx.deferReply).toHaveBeenCalledWith({ ephemeral: true });
 * ```
 */
export function createMockManualContext(
  opts: MockContextOptions = {}
): ManualCommandContext & { reply: ReturnType<typeof vi.fn> } {
  const base = createBaseContextMock(opts);

  return {
    ...base,
    reply: vi.fn().mockResolvedValue({ id: 'response-123' }),
    deferReply: vi.fn().mockResolvedValue({ id: 'response-456' }),
    editReply: vi.fn().mockResolvedValue({ id: 'msg-123' }),
    showModal: vi.fn().mockResolvedValue({ id: 'callback-123' }),
  } as ManualCommandContext & { reply: ReturnType<typeof vi.fn> };
}
