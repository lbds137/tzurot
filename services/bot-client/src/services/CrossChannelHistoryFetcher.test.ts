/**
 * Tests for CrossChannelHistoryFetcher
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelType, type Client } from 'discord.js';
import {
  buildKnownChannelEnvironments,
  clearKnownChannelEnvironmentsCache,
  fetchCrossChannelHistory,
  fetchCrossChannelIfEnabled,
} from './CrossChannelHistoryFetcher.js';
import type { CrossChannelHistoryGroup } from '@tzurot/common-types';
import { MessageRole } from '@tzurot/common-types';

// Mock common-types logger
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
  };
});

function createMockMessage(overrides: Partial<CrossChannelHistoryGroup['messages'][0]> = {}) {
  return {
    id: 'msg-1',
    role: MessageRole.User,
    content: 'Hello',
    tokenCount: 5,
    createdAt: new Date('2026-02-26T10:00:00Z'),
    personaId: 'persona-1',
    personaName: 'TestUser',
    channelId: 'channel-2',
    guildId: 'guild-1',
    discordMessageId: ['discord-msg-1'],
    ...overrides,
  } as CrossChannelHistoryGroup['messages'][0];
}

function createMockConversationHistoryService(groups: CrossChannelHistoryGroup[] = []) {
  return {
    getCrossChannelHistory: vi.fn().mockResolvedValue(groups),
  } as unknown as Parameters<typeof fetchCrossChannelHistory>[0]['conversationHistoryService'];
}

function createMockDiscordClient(
  channelMap: Record<
    string,
    {
      type: ChannelType;
      name?: string;
      guild?: { id: string; name: string };
      isThread?: () => boolean;
      parent?: unknown;
    } | null
  > = {}
) {
  return {
    channels: {
      fetch: vi.fn().mockImplementation(async (id: string) => {
        if (id in channelMap) {
          return channelMap[id];
        }
        throw new Error('Unknown channel');
      }),
    },
  } as unknown as Parameters<typeof fetchCrossChannelHistory>[0]['discordClient'];
}

describe('fetchCrossChannelHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty array when messageBudget is zero', async () => {
    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      messageBudget: 0,
      discordClient: createMockDiscordClient(),
      conversationHistoryService: createMockConversationHistoryService(),
    });

    expect(result).toEqual([]);
  });

  it('should return empty array when no cross-channel history exists', async () => {
    const service = createMockConversationHistoryService([]);

    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      messageBudget: 50,
      discordClient: createMockDiscordClient(),
      conversationHistoryService: service,
    });

    expect(result).toEqual([]);
    expect(service.getCrossChannelHistory).toHaveBeenCalledWith(
      'persona-1',
      'personality-1',
      'channel-1',
      50,
      { maxAgeSeconds: undefined, contextEpoch: undefined }
    );
  });

  it('should resolve guild channel environments', async () => {
    const groups: CrossChannelHistoryGroup[] = [
      {
        channelId: 'channel-2',
        guildId: 'guild-1',
        messages: [createMockMessage()],
      },
    ];

    const discordClient = createMockDiscordClient({
      'channel-2': {
        type: ChannelType.GuildText,
        name: 'general',
        id: 'channel-2',
        guild: { id: 'guild-1', name: 'Test Server' },
        isThread: () => false,
        parent: null,
      } as never,
    });

    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      messageBudget: 50,
      discordClient,
      conversationHistoryService: createMockConversationHistoryService(groups),
    });

    expect(result).toHaveLength(1);
    expect(result[0].channelEnvironment.type).toBe('guild');
    expect(result[0].channelEnvironment.guild?.name).toBe('Test Server');
    expect(result[0].messages).toHaveLength(1);
  });

  it('should resolve thread channels with parent swap', async () => {
    const groups: CrossChannelHistoryGroup[] = [
      {
        channelId: 'thread-1',
        guildId: 'guild-1',
        messages: [createMockMessage()],
      },
    ];

    const discordClient = createMockDiscordClient({
      'thread-1': {
        type: ChannelType.PublicThread,
        name: 'my-thread',
        id: 'thread-1',
        guild: { id: 'guild-1', name: 'Test Server' },
        isThread: () => true,
        parent: {
          id: 'parent-channel',
          name: 'general',
          type: ChannelType.GuildText,
        },
      } as never,
    });

    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      messageBudget: 50,
      discordClient,
      conversationHistoryService: createMockConversationHistoryService(groups),
    });

    expect(result).toHaveLength(1);
    const env = result[0].channelEnvironment;
    expect(env.type).toBe('guild');
    // Channel should be swapped to parent
    expect(env.channel.id).toBe('parent-channel');
    expect(env.channel.name).toBe('general');
    // Thread info should be set
    expect(env.thread).toBeDefined();
    expect(env.thread?.id).toBe('thread-1');
    expect(env.thread?.name).toBe('my-thread');
    expect(env.thread?.parentChannel?.id).toBe('parent-channel');
  });

  it('should resolve DM channel environments', async () => {
    const groups: CrossChannelHistoryGroup[] = [
      {
        channelId: 'dm-channel',
        guildId: null,
        messages: [
          createMockMessage({ channelId: 'dm-channel', guildId: null } as unknown as Partial<
            CrossChannelHistoryGroup['messages'][0]
          >),
        ],
      },
    ];

    const discordClient = createMockDiscordClient({
      'dm-channel': {
        type: ChannelType.DM,
        id: 'dm-channel',
      } as never,
    });

    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      messageBudget: 50,
      discordClient,
      conversationHistoryService: createMockConversationHistoryService(groups),
    });

    expect(result).toHaveLength(1);
    expect(result[0].channelEnvironment.type).toBe('dm');
  });

  it('should use fallback environment when channel fetch returns null', async () => {
    const groups: CrossChannelHistoryGroup[] = [
      {
        channelId: 'deleted-channel',
        guildId: 'guild-1',
        messages: [createMockMessage()],
      },
    ];

    // channels.fetch resolves to null for deleted/unavailable channels
    const discordClient = createMockDiscordClient({ 'deleted-channel': null });

    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      messageBudget: 50,
      discordClient,
      conversationHistoryService: createMockConversationHistoryService(groups),
    });

    expect(result).toHaveLength(1);
    expect(result[0].channelEnvironment.type).toBe('guild');
    expect(result[0].channelEnvironment.guild).toEqual({ id: 'guild-1', name: 'unknown-server' });
    expect(result[0].channelEnvironment.channel.name).toBe('unknown-channel');
  });

  it('should use fallback environment when channel fetch fails', async () => {
    const groups: CrossChannelHistoryGroup[] = [
      {
        channelId: 'deleted-channel',
        guildId: 'guild-1',
        messages: [createMockMessage()],
      },
    ];

    const discordClient = createMockDiscordClient({}); // No channels registered

    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      messageBudget: 50,
      discordClient,
      conversationHistoryService: createMockConversationHistoryService(groups),
    });

    expect(result).toHaveLength(1);
    // Falls back to guild with unknown-channel and guild info from guildId
    expect(result[0].channelEnvironment.type).toBe('guild');
    expect(result[0].channelEnvironment.guild).toEqual({ id: 'guild-1', name: 'unknown-server' });
    expect(result[0].channelEnvironment.channel.name).toBe('unknown-channel');
  });

  it('should use DM fallback when guildId is null and channel fetch fails', async () => {
    const groups: CrossChannelHistoryGroup[] = [
      {
        channelId: 'deleted-dm',
        guildId: null,
        messages: [createMockMessage()],
      },
    ];

    const discordClient = createMockDiscordClient({});

    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      messageBudget: 50,
      discordClient,
      conversationHistoryService: createMockConversationHistoryService(groups),
    });

    expect(result).toHaveLength(1);
    expect(result[0].channelEnvironment.type).toBe('dm');
  });

  it('should resolve multiple groups in parallel', async () => {
    const groups: CrossChannelHistoryGroup[] = [
      {
        channelId: 'channel-2',
        guildId: 'guild-1',
        messages: [createMockMessage()],
      },
      {
        channelId: 'channel-3',
        guildId: 'guild-1',
        messages: [createMockMessage(), createMockMessage({ id: 'msg-2', content: 'World' })],
      },
    ];

    const discordClient = createMockDiscordClient({
      'channel-2': {
        type: ChannelType.GuildText,
        name: 'general',
        id: 'channel-2',
        guild: { id: 'guild-1', name: 'Server' },
        isThread: () => false,
        parent: null,
      } as never,
      'channel-3': {
        type: ChannelType.GuildText,
        name: 'random',
        id: 'channel-3',
        guild: { id: 'guild-1', name: 'Server' },
        isThread: () => false,
        parent: null,
      } as never,
    });

    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      messageBudget: 50,
      discordClient,
      conversationHistoryService: createMockConversationHistoryService(groups),
    });

    expect(result).toHaveLength(2);
    expect(result[0].messages).toHaveLength(1);
    expect(result[1].messages).toHaveLength(2);
  });

  it('should detect category parent for guild channels', async () => {
    const groups: CrossChannelHistoryGroup[] = [
      {
        channelId: 'channel-2',
        guildId: 'guild-1',
        messages: [createMockMessage()],
      },
    ];

    const discordClient = createMockDiscordClient({
      'channel-2': {
        type: ChannelType.GuildText,
        name: 'general',
        id: 'channel-2',
        guild: { id: 'guild-1', name: 'Test Server' },
        isThread: () => false,
        parent: {
          id: 'cat-1',
          name: 'Text Channels',
          type: ChannelType.GuildCategory,
        },
      } as never,
    });

    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      messageBudget: 50,
      discordClient,
      conversationHistoryService: createMockConversationHistoryService(groups),
    });

    expect(result).toHaveLength(1);
    const env = result[0].channelEnvironment;
    expect(env.type).toBe('guild');
    expect(env.category).toEqual({ id: 'cat-1', name: 'Text Channels' });
    expect(env.channel.name).toBe('general');
  });

  it('should handle thread with null parent (deletion race)', async () => {
    const groups: CrossChannelHistoryGroup[] = [
      {
        channelId: 'thread-1',
        guildId: 'guild-1',
        messages: [createMockMessage()],
      },
    ];

    const discordClient = createMockDiscordClient({
      'thread-1': {
        type: ChannelType.PublicThread,
        name: 'orphan-thread',
        id: 'thread-1',
        guild: { id: 'guild-1', name: 'Test Server' },
        isThread: () => true,
        parent: null, // Deletion race: parent channel was deleted
      } as never,
    });

    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      messageBudget: 50,
      discordClient,
      conversationHistoryService: createMockConversationHistoryService(groups),
    });

    expect(result).toHaveLength(1);
    const env = result[0].channelEnvironment;
    expect(env.type).toBe('guild');
    // Thread appears as a regular channel (no parent swap)
    expect(env.channel.id).toBe('thread-1');
    expect(env.channel.name).toBe('orphan-thread');
    // No thread info since parent is null
    expect(env.thread).toBeUndefined();
  });

  it('should use "unknown" for unmapped channel types', async () => {
    const groups: CrossChannelHistoryGroup[] = [
      {
        channelId: 'channel-2',
        guildId: 'guild-1',
        messages: [createMockMessage()],
      },
    ];

    const discordClient = createMockDiscordClient({
      'channel-2': {
        type: ChannelType.GuildStageVoice,
        name: 'stage-channel',
        id: 'channel-2',
        guild: { id: 'guild-1', name: 'Test Server' },
        isThread: () => false,
        parent: null,
      } as never,
    });

    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      messageBudget: 50,
      discordClient,
      conversationHistoryService: createMockConversationHistoryService(groups),
    });

    expect(result).toHaveLength(1);
    expect(result[0].channelEnvironment.channel.type).toBe('unknown');
  });
});

describe('fetchCrossChannelIfEnabled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return undefined when not enabled', async () => {
    const result = await fetchCrossChannelIfEnabled({
      enabled: false,
      channelId: 'channel-1',
      personaId: 'persona-1',
      personalityId: 'p-1',
      dbLimit: 50,
      discordClient: createMockDiscordClient(),
      conversationHistoryService: createMockConversationHistoryService(),
    });
    expect(result).toBeUndefined();
  });

  it('fetches cross-channel history with its own dbLimit budget regardless of current-channel size', async () => {
    // Regression test for the residual-filler bug: prior code computed the
    // cross-channel budget as `dbLimit - currentHistoryLength` and silently
    // skipped when the current channel was full. The user-reported
    // symptom was zero cross-channel context after setting maxAge=48h on a
    // personality whose current thread was 5 days stale — the stale rows leaked
    // through (separate bug, fixed in getChannelHistory) and starved this fetch.
    const service = createMockConversationHistoryService([
      { channelId: 'channel-2', guildId: null, messages: [createMockMessage()] },
    ]);

    const result = await fetchCrossChannelIfEnabled({
      enabled: true,
      channelId: 'channel-1',
      personaId: 'persona-1',
      personalityId: 'p-1',
      dbLimit: 50,
      discordClient: createMockDiscordClient(),
      conversationHistoryService: service,
    });

    expect(result).toHaveLength(1);
    // The DB query receives dbLimit (50) as its own budget, NOT a residual.
    expect(service.getCrossChannelHistory).toHaveBeenCalledWith(
      'persona-1',
      'p-1',
      'channel-1',
      50,
      { maxAgeSeconds: undefined, contextEpoch: undefined }
    );
  });

  it('threads maxAge and contextEpoch through to the DB query', async () => {
    const service = createMockConversationHistoryService([]);
    const epoch = new Date('2026-05-01T00:00:00Z');

    await fetchCrossChannelIfEnabled({
      enabled: true,
      channelId: 'channel-1',
      personaId: 'persona-1',
      personalityId: 'p-1',
      dbLimit: 50,
      discordClient: createMockDiscordClient(),
      conversationHistoryService: service,
      maxAge: 3600,
      contextEpoch: epoch,
    });

    expect(service.getCrossChannelHistory).toHaveBeenCalledWith(
      'persona-1',
      'p-1',
      'channel-1',
      50,
      { maxAgeSeconds: 3600, contextEpoch: epoch }
    );
  });

  it('returns [] (NOT undefined) when enabled but the DB returned no eligible messages', async () => {
    // Distinguishing []-when-enabled from undefined-when-disabled is what
    // lets the diagnostic surface render "Cross-channel: 0 msgs" — the
    // silent-skip case where a context bug (wrong filter, fetch failure)
    // would otherwise be invisible. Collapsing both to undefined re-creates
    // the gap.
    const result = await fetchCrossChannelIfEnabled({
      enabled: true,
      channelId: 'channel-1',
      personaId: 'persona-1',
      personalityId: 'p-1',
      dbLimit: 50,
      discordClient: createMockDiscordClient(),
      conversationHistoryService: createMockConversationHistoryService([]),
    });
    expect(result).toEqual([]);
  });
});

describe('buildKnownChannelEnvironments', () => {
  const makeClient = (channels: Map<string, unknown>): Client =>
    ({ channels: { cache: channels } }) as unknown as Client;

  const guildTextChannel = (id: string, name: string) => ({
    id,
    name,
    type: ChannelType.GuildText,
    guild: { id: 'guild-1', name: 'Test Guild' },
    isThread: () => false,
    parent: null,
  });

  beforeEach(() => {
    clearKnownChannelEnvironmentsCache();
  });

  it('builds an env entry per cached guild channel and skips non-guild channels', () => {
    const channels = new Map<string, unknown>([
      ['111', guildTextChannel('111', 'general')],
      ['222', guildTextChannel('222', 'random')],
      // DM channel: no guild — skipped
      ['333', { id: '333', type: ChannelType.DM, isThread: () => false }],
    ]);

    const map = buildKnownChannelEnvironments(makeClient(channels));

    expect(Object.keys(map).sort()).toEqual(['111', '222']);
    expect(map['111']).toMatchObject({
      type: 'guild',
      guild: { id: 'guild-1', name: 'Test Guild' },
      channel: { id: '111', name: 'general' },
    });
  });

  it('serves the cached map within the TTL window (one cache walk)', () => {
    const channels = new Map<string, unknown>([['111', guildTextChannel('111', 'general')]]);
    const client = makeClient(channels);

    const first = buildKnownChannelEnvironments(client);
    channels.set('999', guildTextChannel('999', 'late-arrival'));
    const second = buildKnownChannelEnvironments(client);

    // Same object back — the late-arriving channel is invisible until the
    // TTL expires (channel renames/additions are rare; this is by design).
    expect(second).toBe(first);
    expect(second['999']).toBeUndefined();
  });
});
