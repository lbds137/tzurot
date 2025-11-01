/**
 * Discord.js Mock Factories
 *
 * **Architectural Decision: Pragmatic Mock Factories**
 *
 * After consulting Gemini (via MCP), we adopted a pragmatic factory pattern that balances
 * type safety with maintainability. Each factory creates a "good enough" mock for testing.
 *
 * **The Pattern:**
 * 1. Define sensible defaults for commonly used properties
 * 2. Accept `Partial<T>` for overrides (simple and flexible)
 * 3. Use `as unknown as T` for the final assertion (explicit and honest)
 * 4. Mock methods with vi.fn() to avoid Object.prototype conflicts
 *
 * **Why this approach:**
 * - Tests pass at runtime (the only thing that matters)
 * - Much simpler than complex conditional types
 * - Easy for developers to understand and extend
 * - Avoids fighting TypeScript's type system on mock internals
 *
 * **Trade-off:**
 * We use `as unknown as` which bypasses some type checking. This is intentional.
 * The mocks only need to be "good enough" for our tests, not perfect replicas.
 * Our passing tests are the safety net.
 *
 * **ID Generation:**
 * Currently uses hardcoded default IDs (e.g., '123456789012345678'). If tests need
 * unique IDs (e.g., testing ID-based lookups), pass explicit IDs via overrides.
 * Future enhancement: Add resetMockIdCounters() and auto-incrementing IDs if needed.
 *
 * **Future Evolution: Anti-Corruption Layer**
 * Long-term, we should create minimal interfaces (IAppMessage, etc.) to decouple
 * from Discord.js. This would allow better type safety without the complexity.
 * See TESTING_LESSONS_LEARNED.md for the roadmap.
 */

import { vi } from 'vitest';
import { ChannelType, Collection } from 'discord.js';
import type { Message, TextChannel, DMChannel, ThreadChannel, Guild, User, GuildMember, CategoryChannel, Snowflake, Role, MessageMentions, GuildTextBasedChannel } from 'discord.js';

/**
 * Create a mock Discord Collection, optionally pre-filled with items
 *
 * Uses the real Collection class from Discord.js as it's primarily a data structure
 */
export function createMockCollection<K, V>(initialValues: [K, V][] = []): Collection<K, V> {
  return new Collection<K, V>(initialValues);
}

/**
 * Create a mock MessageMentions object
 */
export function createMockMessageMentions(overrides: Partial<MessageMentions> = {}): MessageMentions {
  const defaults: Partial<MessageMentions> = {
    users: createMockCollection<Snowflake, User>(),
    roles: createMockCollection<Snowflake, Role>(),
    members: createMockCollection<Snowflake, GuildMember>(),
    channels: createMockCollection<Snowflake, GuildTextBasedChannel>(),
    crosspostedChannels: createMockCollection(),
    everyone: false,
    repliedUser: null,
    has: vi.fn().mockReturnValue(false),
  };

  return { ...defaults, ...overrides } as unknown as MessageMentions;
}

/**
 * Create a mock Discord User
 */
export function createMockUser(overrides: Partial<User> = {}): User {
  const id = overrides.id ?? '123456789012345678';

  const defaults = {
    id,
    username: 'TestUser',
    discriminator: '0',
    globalName: 'Test User',
    bot: false,
    system: false,
    tag: 'TestUser#0',
    // Plain arrow function - we don't need to spy on toString()
    toString: () => `<@${id}>`,
  } as Partial<User>;

  return { ...defaults, ...overrides } as unknown as User;
}

/**
 * Create a mock Discord Guild
 */
export function createMockGuild(overrides: Partial<Guild> = {}): Guild {
  const id = overrides.id ?? '987654321098765432';

  const defaults: Partial<Guild> = {
    id,
    name: 'Test Server',
    ownerId: '111111111111111111',
    memberCount: 100,
    // Plain arrow function - we don't need to spy on valueOf()
    valueOf: () => id,
  };

  return { ...defaults, ...overrides } as unknown as Guild;
}

/**
 * Create a mock Discord Category Channel
 */
export function createMockCategoryChannel(overrides: Partial<CategoryChannel> = {}): CategoryChannel {
  const id = overrides.id ?? '555555555555555555';

  const defaults: Partial<CategoryChannel> = {
    id,
    name: 'General',
    type: ChannelType.GuildCategory,
    guild: createMockGuild(),
    // Plain arrow functions - we don't need to spy on these
    toString: () => `<#${id}>`,
    valueOf: () => id,
  };

  return { ...defaults, ...overrides } as unknown as CategoryChannel;
}

/**
 * Create a mock Discord Text Channel
 */
export function createMockTextChannel(overrides: Partial<TextChannel> = {}): TextChannel {
  const id = overrides.id ?? '444444444444444444';

  const defaults: Partial<TextChannel> = {
    id,
    name: 'general',
    type: ChannelType.GuildText,
    guild: createMockGuild(),
    parent: null,
    // @ts-expect-error - Type predicates cannot be replicated by vi.fn(). Runtime behavior is correct.
    isThread: vi.fn(() => false),
    // @ts-expect-error - Type predicates cannot be replicated by vi.fn(). Runtime behavior is correct.
    isTextBased: vi.fn(() => true),
    send: vi.fn().mockResolvedValue(null),
    // Plain arrow functions - we don't need to spy on these
    toString: () => `<#${id}>`,
    valueOf: () => id,
  };

  return { ...defaults, ...overrides } as unknown as TextChannel;
}

/**
 * Create a mock Discord DM Channel
 */
export function createMockDMChannel(overrides: Partial<DMChannel> = {}): DMChannel {
  const id = overrides.id ?? '333333333333333333';

  const defaults: Partial<DMChannel> = {
    id,
    type: ChannelType.DM,
    recipient: createMockUser(),
    // @ts-expect-error - Type predicates cannot be replicated by vi.fn(). Runtime behavior is correct.
    isThread: vi.fn(() => false),
    // @ts-expect-error - Type predicates cannot be replicated by vi.fn(). Runtime behavior is correct.
    isTextBased: vi.fn(() => true),
    send: vi.fn().mockResolvedValue(null),
    // Plain arrow functions - we don't need to spy on these
    toString: () => `<@${id}>`, // DM channels use @, not #
    valueOf: () => id,
  };

  return { ...defaults, ...overrides } as unknown as DMChannel;
}

/**
 * Create a mock Discord Thread Channel
 */
export function createMockThreadChannel(overrides: Partial<ThreadChannel> = {}): ThreadChannel {
  const id = overrides.id ?? '222222222222222222';

  const defaults: Partial<ThreadChannel> = {
    id,
    name: 'test-thread',
    type: ChannelType.PublicThread,
    guild: createMockGuild(),
    parent: null, // Override with actual parent channel
    ownerId: '123456789012345678',
    // @ts-expect-error - Type predicates cannot be replicated by vi.fn(). Runtime behavior is correct.
    isThread: vi.fn(() => true),
    // @ts-expect-error - Type predicates cannot be replicated by vi.fn(). Runtime behavior is correct.
    isTextBased: vi.fn(() => true),
    send: vi.fn().mockResolvedValue(null),
    // Plain arrow functions - we don't need to spy on these
    toString: () => `<#${id}>`,
    valueOf: () => id,
  };

  return { ...defaults, ...overrides } as unknown as ThreadChannel;
}

/**
 * Create a mock Discord Guild Member
 */
export function createMockGuildMember(overrides: Partial<GuildMember> = {}): GuildMember {
  const id = overrides.id ?? '123456789012345678';

  const defaults = {
    id,
    user: createMockUser(),
    guild: createMockGuild(),
    nickname: null,
    displayName: 'Test User',
    // Plain arrow function - we don't need to spy on toString()
    toString: () => `<@${id}>`,
  } as Partial<GuildMember>;

  return { ...defaults, ...overrides } as unknown as GuildMember;
}

/**
 * Create a mock Discord Message
 *
 * @example
 * ```typescript
 * const message = createMockMessage({
 *   content: 'Hello @Lilith!',
 *   author: createMockUser({ username: 'TestUser' }),
 *   channel: createMockTextChannel({ name: 'general' })
 * });
 * ```
 */
export function createMockMessage(overrides: Partial<Message> = {}): Message {
  const id = overrides.id ?? '999999999999999999';

  const defaults: Partial<Message> = {
    id,
    content: 'Test message',
    author: createMockUser(),
    channel: createMockTextChannel(),
    guild: createMockGuild(),
    member: createMockGuildMember(),
    createdTimestamp: Date.now(),
    createdAt: new Date(),
    mentions: createMockMessageMentions(),
    attachments: createMockCollection(),
    embeds: [],
    reference: null,
    type: 0, // DEFAULT message type
    reply: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(null),
    edit: vi.fn().mockResolvedValue(null),
    react: vi.fn().mockResolvedValue(null),
    fetch: vi.fn().mockResolvedValue(null),
    // Plain arrow functions - we don't need to spy on these
    toString: () => `<#${id}>`,
    valueOf: () => id,
  };

  return { ...defaults, ...overrides } as unknown as Message;
}

/**
 * Create a mock Message in a DM channel
 */
export function createMockDMMessage(overrides: Partial<Message> = {}): Message {
  return createMockMessage({
    channel: createMockDMChannel(),
    guild: null,
    member: null,
    ...overrides,
  });
}

/**
 * Create a mock Message in a thread
 */
export function createMockThreadMessage(overrides: Partial<Message> = {}): Message {
  return createMockMessage({
    // @ts-expect-error - ThreadChannel is part of Message.channel union type. Runtime behavior is correct.
    channel: createMockThreadChannel(),
    ...overrides,
  });
}
