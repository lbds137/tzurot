/**
 * Tests for LinkExtractor
 *
 * Covers the two live methods: fetchMessageFromLink (channel resolution + the
 * guarded message fetch) and its private verifyInvokerCanAccessSource access
 * gate (exercised through fetchMessageFromLink, the public entry point). The
 * former extractLinkReferences orchestration was removed as dead code; these
 * tests target the live methods directly rather than through it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkExtractor } from './LinkExtractor.js';
import { ChannelType } from 'discord.js';
import type { Message, Guild, Channel, TextChannel, Client } from 'discord.js';
import type { ParsedMessageLink } from '@tzurot/common-types/utils/messageLinkParser';

// The standard same-guild link every test resolves against createMockMessage's
// guild-123 / channel-123 fixture. Passed straight to fetchMessageFromLink —
// no MessageLinkParser involved (that lived in the removed orchestration).
const TEST_LINK: ParsedMessageLink = {
  fullUrl: 'https://discord.com/channels/guild-123/channel-123/ref-msg-123',
  guildId: 'guild-123',
  channelId: 'channel-123',
  messageId: 'ref-msg-123',
};

// Type for mock input - allows any properties to be overridden
type MockMessageInput = Record<string, unknown>;

// Helper to create mock Discord message.
// Security-check defaults: channel returns a permissive `permissionsFor` result
// and the guild returns a valid member on `members.fetch`, so non-access tests
// pass the gate. Access-control tests override these per-case.
function createMockMessage(overrides: MockMessageInput = {}): Message {
  const permissiveChannelMethods = {
    isDMBased: vi.fn(() => false),
    isThread: vi.fn(() => false),
    permissionsFor: vi.fn(() => ({ has: vi.fn(() => true) })),
  };

  const mockGuild = {
    id: 'guild-123',
    name: 'Test Guild',
    members: {
      fetch: vi.fn().mockResolvedValue({ id: 'user-123' }),
    },
  } as unknown as Guild;

  const mockChannel = {
    id: 'channel-123',
    type: 0, // GUILD_TEXT
    isTextBased: vi.fn(() => true),
    messages: {
      fetch: vi.fn(),
    },
    guild: mockGuild,
    ...permissiveChannelMethods,
  } as unknown as TextChannel;

  // Attach the channel into the guild's channel cache now that both exist
  (mockGuild as any).channels = {
    cache: new Map([[mockChannel.id, mockChannel as Channel]]),
    fetch: vi.fn(),
  };

  const mockClient: Partial<Client> = {
    guilds: {
      cache: new Map([[mockGuild.id!, mockGuild as Guild]]),
      fetch: vi.fn(),
    } as any,
    channels: {
      fetch: vi.fn().mockResolvedValue(mockChannel),
    } as any,
  };

  return {
    id: 'msg-123',
    content: 'Test message',
    author: {
      id: 'user-123',
      username: 'TestUser',
      bot: false,
    } as any,
    guild: mockGuild as Guild,
    channel: mockChannel as TextChannel,
    client: mockClient as Client,
    createdAt: new Date(),
    webhookId: null,
    reference: null,
    messageSnapshots: undefined,
    ...overrides,
  } as unknown as Message;
}

describe('LinkExtractor', () => {
  let linkExtractor: LinkExtractor;

  beforeEach(() => {
    linkExtractor = new LinkExtractor();
    vi.clearAllMocks();
  });

  describe('fetchMessageFromLink — channel resolution + guarded fetch', () => {
    it('returns the fetched message on the same-guild happy path', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      const fetched = createMockMessage({ id: 'ref-msg-123' });
      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(fetched as any);

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBe(fetched);
      expect(mockChannel.messages.fetch).toHaveBeenCalledWith('ref-msg-123');
    });

    it('returns null when the channel is not text-based', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      (mockChannel as any).isTextBased = vi.fn(() => false);

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBeNull();
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('fetches the channel via the client when not in the guild cache (thread path)', async () => {
      const mockMessage = createMockMessage();
      const sourceGuild = mockMessage.guild!;
      // Empty the guild cache so resolveSourceChannel misses → client.channels.fetch.
      (sourceGuild as any).channels = { cache: new Map(), fetch: vi.fn() };

      const threadChannel = {
        id: 'channel-123',
        isTextBased: vi.fn(() => true),
        isThread: vi.fn(() => false),
        isDMBased: vi.fn(() => false),
        permissionsFor: vi.fn(() => ({ has: vi.fn(() => true) })),
        guild: sourceGuild,
        messages: { fetch: vi.fn().mockResolvedValue(createMockMessage({ id: 'ref-msg-123' })) },
      } as unknown as TextChannel;
      vi.mocked(mockMessage.client.channels.fetch).mockResolvedValue(threadChannel as any);

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).not.toBeNull();
      expect(mockMessage.client.channels.fetch).toHaveBeenCalledWith('channel-123');
    });

    it('fetches the guild when not in cache, then resolves the channel', async () => {
      const mockMessage = createMockMessage();
      // Remove the guild from cache so resolveSourceChannel calls guilds.fetch.
      (mockMessage.client.guilds.cache as Map<string, Guild>).clear();
      const fetchedGuild = mockMessage.guild!;
      vi.mocked(mockMessage.client.guilds.fetch).mockResolvedValue(fetchedGuild as any);
      const mockChannel = mockMessage.channel as TextChannel;
      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(
        createMockMessage({ id: 'ref-msg-123' }) as any
      );

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).not.toBeNull();
      expect(mockMessage.client.guilds.fetch).toHaveBeenCalledWith('guild-123');
    });

    it('returns null when the guild fetch fails', async () => {
      const mockMessage = createMockMessage();
      (mockMessage.client.guilds.cache as Map<string, Guild>).clear();
      vi.mocked(mockMessage.client.guilds.fetch).mockRejectedValue(new Error('No access') as never);
      // The thread-fetch fallback must also miss, else it rescues the null guild.
      vi.mocked(mockMessage.client.channels.fetch).mockResolvedValue(null as any);

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBeNull();
    });

    it('returns null when a DM-format link channel fetch fails', async () => {
      const mockMessage = createMockMessage();
      vi.mocked(mockMessage.client.channels.fetch).mockRejectedValue(
        new Error('DM not accessible') as never
      );

      const dmLink: ParsedMessageLink = {
        fullUrl: 'https://discord.com/channels/@me/dm-channel-1/ref-msg-dm',
        guildId: null,
        channelId: 'dm-channel-1',
        messageId: 'ref-msg-dm',
      };
      const result = await linkExtractor.fetchMessageFromLink(dmLink, mockMessage);

      expect(result).toBeNull();
    });

    it('returns null when the client channel fetch fails (thread path)', async () => {
      const mockMessage = createMockMessage();
      const sourceGuild = mockMessage.guild!;
      (sourceGuild as any).channels = { cache: new Map(), fetch: vi.fn() };
      vi.mocked(mockMessage.client.channels.fetch).mockRejectedValue(
        new Error('Unknown Channel') as never
      );

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBeNull();
    });

    it('resolves a DM-format link (guildId === null) via a direct channel fetch', async () => {
      const mockMessage = createMockMessage();
      const dmChannel = {
        id: 'dm-channel-1',
        isTextBased: vi.fn(() => true),
        isThread: vi.fn(() => false),
        isDMBased: vi.fn(() => true),
        recipientId: 'user-123',
        messages: { fetch: vi.fn().mockResolvedValue(createMockMessage({ id: 'ref-msg-dm' })) },
      } as unknown as TextChannel;
      vi.mocked(mockMessage.client.channels.fetch).mockResolvedValue(dmChannel as any);

      const dmLink: ParsedMessageLink = {
        fullUrl: 'https://discord.com/channels/@me/dm-channel-1/ref-msg-dm',
        guildId: null,
        channelId: 'dm-channel-1',
        messageId: 'ref-msg-dm',
      };
      const result = await linkExtractor.fetchMessageFromLink(dmLink, mockMessage);

      expect(result).not.toBeNull();
      expect(mockMessage.client.channels.fetch).toHaveBeenCalledWith('dm-channel-1');
    });

    it.each([
      { label: 'Unknown Message (10008)', code: 10008 },
      { label: 'Missing Access (50001)', code: 50001 },
      { label: 'Missing Permissions (50013)', code: 50013 },
      { label: 'unexpected error (no code)', code: undefined },
    ])('returns null when messages.fetch throws $label', async ({ code }) => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      const err = Object.assign(new Error('fetch failed'), code === undefined ? {} : { code });
      vi.mocked(mockChannel.messages.fetch).mockRejectedValue(err as never);

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBeNull();
    });
  });

  describe('access control (verifyInvokerCanAccessSource)', () => {
    it('allows expansion when invoker has ViewChannel + ReadMessageHistory in same-guild source', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(
        createMockMessage({ id: 'ref-msg-123' }) as any
      );

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).not.toBeNull();
      expect(mockChannel.messages.fetch).toHaveBeenCalledWith('ref-msg-123');
      // Assert the permission check ACTUALLY RAN, not just that the happy
      // path produced the right result. Without this assertion, a future
      // refactor that accidentally bypasses `permissionsFor()` would still
      // pass because the default permissive mocks let expansion succeed.
      expect(mockChannel.permissionsFor).toHaveBeenCalled();
    });

    it('denies expansion when invoker lacks ViewChannel on source channel', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      (mockChannel as any).permissionsFor = vi.fn(() => ({ has: vi.fn(() => false) }));

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBeNull();
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('denies expansion when invoker has ViewChannel but not ReadMessageHistory', async () => {
      // Documents the AND-semantics: production asserts BOTH flags via
      // `permissions.has([ViewChannel, ReadMessageHistory])`. The mock catches
      // a scalar-vs-array shape change (a refactor to `has(ViewChannel)`); a
      // flag-CONTENT change like `has([ViewChannel])` would still be an array
      // and need a length/content check to catch.
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      (mockChannel as any).permissionsFor = vi.fn(() => ({
        has: vi.fn((flags: unknown) => {
          // The production call passes an array of both flags → must return false.
          if (Array.isArray(flags)) {
            return false;
          }
          // A single-flag call (what a weakened refactor might use) → would be true.
          return true;
        }),
      }));

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBeNull();
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('allows expansion when invoker IS a member of the source guild (cross-guild happy path)', async () => {
      // Critical correctness test: the access check must target the SOURCE
      // guild (owner of the linked channel), NOT the invoker's current guild.
      // A naive refactor using the invoker's guild would pass the same-guild
      // tests but break cross-guild access control — caught here by giving the
      // two guilds DIFFERENT members.fetch mocks.
      const mockMessage = createMockMessage();
      const invokerCurrentGuild = mockMessage.guild!;

      const sourceGuildFetch = vi.fn().mockResolvedValue({ id: 'user-123' });
      const sourceGuild = {
        id: 'other-guild-999',
        name: 'Other Guild',
        members: { fetch: sourceGuildFetch },
      } as unknown as Guild;

      const foreignChannel = {
        id: 'channel-456',
        isTextBased: vi.fn(() => true),
        isThread: vi.fn(() => false),
        isDMBased: vi.fn(() => false),
        permissionsFor: vi.fn(() => ({ has: vi.fn(() => true) })),
        guild: sourceGuild,
        messages: {
          fetch: vi.fn().mockResolvedValue(createMockMessage({ id: 'ref-msg-456' })),
        },
      } as unknown as TextChannel;

      // Client-level resolution: guilds.fetch → source guild; its channel cache
      // misses → client.channels.fetch → the foreign channel.
      vi.mocked(mockMessage.client.guilds.fetch).mockResolvedValue(sourceGuild as any);
      vi.mocked(mockMessage.client.channels.fetch).mockResolvedValue(foreignChannel as any);
      (sourceGuild as any).channels = { cache: new Map() };

      const crossGuildLink: ParsedMessageLink = {
        fullUrl: 'https://discord.com/channels/other-guild-999/channel-456/ref-msg-456',
        guildId: 'other-guild-999',
        channelId: 'channel-456',
        messageId: 'ref-msg-456',
      };
      const result = await linkExtractor.fetchMessageFromLink(crossGuildLink, mockMessage);

      expect(result).not.toBeNull();
      // CRITICAL: the SOURCE guild's fetch was called, NOT the invoker's current guild's.
      expect(sourceGuildFetch).toHaveBeenCalledWith('user-123');
      expect(invokerCurrentGuild.members.fetch).not.toHaveBeenCalled();
    });

    it('denies expansion when invoker is not a member of the source guild (cross-guild leak)', async () => {
      // Classic exploit: bot is in private guild Y, attacker in guild X pastes a
      // guild-Y link. Invoker isn't in guild Y → members.fetch rejects → deny.
      const mockMessage = createMockMessage();
      const mockGuild = mockMessage.guild!;
      const mockChannel = mockMessage.channel as TextChannel;
      vi.mocked(mockGuild.members.fetch).mockRejectedValue(new Error('Unknown Member') as never);

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBeNull();
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('allows expansion when invoker is a DM participant (self-reference to own DM)', async () => {
      // Legitimate case: you paste a link to your own DM with the bot.
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      (mockChannel as any).isDMBased = vi.fn(() => true);
      (mockChannel as any).recipientId = 'user-123';
      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(
        createMockMessage({ id: 'ref-msg-123' }) as any
      );

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).not.toBeNull();
    });

    it('denies expansion when invoker is NOT a DM participant (third-party DM leak)', async () => {
      // Exploit: someone pastes a link to a DM they're not part of.
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      (mockChannel as any).isDMBased = vi.fn(() => true);
      (mockChannel as any).recipientId = 'some-other-user-999';

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBeNull();
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('denies expansion for private thread when invoker is not a thread member', async () => {
      // Private threads (type 12) have an explicit member list — parent
      // ViewChannel isn't enough.
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      (mockChannel as any).isThread = vi.fn(() => true);
      (mockChannel as any).type = ChannelType.PrivateThread;
      (mockChannel as any).members = {
        fetch: vi.fn().mockRejectedValue(new Error('Unknown Member')),
      };

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBeNull();
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('allows expansion for private thread when invoker IS a thread member', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      (mockChannel as any).isThread = vi.fn(() => true);
      (mockChannel as any).type = ChannelType.PrivateThread;
      (mockChannel as any).members = {
        fetch: vi.fn().mockResolvedValue({ id: 'user-123' }),
      };
      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(
        createMockMessage({ id: 'ref-msg-123' }) as any
      );

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).not.toBeNull();
    });

    it('allows expansion for PUBLIC thread (inherits parent permissions, no extra check)', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      (mockChannel as any).isThread = vi.fn(() => true);
      (mockChannel as any).type = ChannelType.PublicThread;
      vi.mocked(mockChannel.messages.fetch).mockResolvedValue(
        createMockMessage({ id: 'ref-msg-123' }) as any
      );

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).not.toBeNull();
    });

    it('fails closed when permissionsFor returns null (unexpected Discord.js state)', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      (mockChannel as any).permissionsFor = vi.fn(() => null);

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBeNull();
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('fails closed when a permission check throws unexpectedly (catch-all)', async () => {
      // Any unexpected error inside the access check (here permissionsFor
      // throwing) must be swallowed into a denial, not propagate.
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      (mockChannel as any).permissionsFor = vi.fn(() => {
        throw new Error('Discord.js internal failure');
      });

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBeNull();
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });

    it('fails closed when a non-DM channel has no guild reference (malformed state)', async () => {
      const mockMessage = createMockMessage();
      const mockChannel = mockMessage.channel as TextChannel;
      (mockChannel as any).guild = null;

      const result = await linkExtractor.fetchMessageFromLink(TEST_LINK, mockMessage);

      expect(result).toBeNull();
      expect(mockChannel.messages.fetch).not.toHaveBeenCalled();
    });
  });
});
