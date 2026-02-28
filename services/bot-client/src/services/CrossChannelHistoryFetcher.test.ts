/**
 * Tests for CrossChannelHistoryFetcher
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType } from 'discord.js';
import {
  fetchCrossChannelHistory,
  fetchCrossChannelIfEnabled,
  mapCrossChannelToApiFormat,
} from './CrossChannelHistoryFetcher.js';
import type { CrossChannelHistoryGroup, LoadedPersonality } from '@tzurot/common-types';
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
    vi.restoreAllMocks();
  });

  it('should return empty array when remainingMessageBudget is zero', async () => {
    const result = await fetchCrossChannelHistory({
      personaId: 'persona-1',
      personalityId: 'personality-1',
      currentChannelId: 'channel-1',
      remainingMessageBudget: 0,
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
      remainingMessageBudget: 50,
      discordClient: createMockDiscordClient(),
      conversationHistoryService: service,
    });

    expect(result).toEqual([]);
    expect(service.getCrossChannelHistory).toHaveBeenCalledWith(
      'persona-1',
      'personality-1',
      'channel-1',
      50
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
      remainingMessageBudget: 50,
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
      remainingMessageBudget: 50,
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
      remainingMessageBudget: 50,
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
      remainingMessageBudget: 50,
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
      remainingMessageBudget: 50,
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
      remainingMessageBudget: 50,
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
      remainingMessageBudget: 50,
      discordClient,
      conversationHistoryService: createMockConversationHistoryService(groups),
    });

    expect(result).toHaveLength(2);
    expect(result[0].messages).toHaveLength(1);
    expect(result[1].messages).toHaveLength(2);
  });
});

describe('fetchCrossChannelIfEnabled', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return undefined when not enabled', async () => {
    const result = await fetchCrossChannelIfEnabled({
      enabled: false,
      channelId: 'channel-1',
      personaId: 'persona-1',
      personality: { id: 'p-1' } as LoadedPersonality,
      currentHistoryLength: 0,
      dbLimit: 50,
      discordClient: createMockDiscordClient(),
      conversationHistoryService: createMockConversationHistoryService(),
    });
    expect(result).toBeUndefined();
  });

  it('should return undefined when no budget remaining', async () => {
    const result = await fetchCrossChannelIfEnabled({
      enabled: true,
      channelId: 'channel-1',
      personaId: 'persona-1',
      personality: { id: 'p-1' } as LoadedPersonality,
      currentHistoryLength: 50,
      dbLimit: 50,
      discordClient: createMockDiscordClient(),
      conversationHistoryService: createMockConversationHistoryService(),
    });
    expect(result).toBeUndefined();
  });

  it('should fetch cross-channel history when enabled with budget', async () => {
    const groups: CrossChannelHistoryGroup[] = [
      { channelId: 'channel-2', guildId: null, messages: [createMockMessage()] },
    ];

    const result = await fetchCrossChannelIfEnabled({
      enabled: true,
      channelId: 'channel-1',
      personaId: 'persona-1',
      personality: { id: 'p-1' } as LoadedPersonality,
      currentHistoryLength: 1,
      dbLimit: 50,
      discordClient: createMockDiscordClient(),
      conversationHistoryService: createMockConversationHistoryService(groups),
    });

    expect(result).toHaveLength(1);
  });

  it('should return undefined when cross-channel returns empty', async () => {
    const result = await fetchCrossChannelIfEnabled({
      enabled: true,
      channelId: 'channel-1',
      personaId: 'persona-1',
      personality: { id: 'p-1' } as LoadedPersonality,
      currentHistoryLength: 1,
      dbLimit: 50,
      discordClient: createMockDiscordClient(),
      conversationHistoryService: createMockConversationHistoryService([]),
    });
    expect(result).toBeUndefined();
  });
});

describe('mapCrossChannelToApiFormat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should map groups to API format with ISO date strings', () => {
    const date = new Date('2026-02-26T10:00:00Z');
    const groups = [
      {
        channelEnvironment: {
          type: 'dm' as const,
          channel: { id: 'ch-1', name: 'DM', type: 'dm' },
        },
        messages: [
          {
            id: 'msg-1',
            role: MessageRole.User,
            content: 'Hello',
            tokenCount: 5,
            createdAt: date,
            personaId: 'p-1',
            personaName: 'User',
            channelId: 'ch-1',
            guildId: null,
            discordMessageId: ['d-1'],
          } as CrossChannelHistoryGroup['messages'][0],
        ],
      },
    ];

    const result = mapCrossChannelToApiFormat(groups);

    expect(result).toHaveLength(1);
    expect(result[0].channelEnvironment.type).toBe('dm');
    const msg = result[0].messages[0];
    expect(msg.id).toBe('msg-1');
    expect(msg.role).toBe(MessageRole.User);
    expect(msg.content).toBe('Hello');
    expect(msg.tokenCount).toBe(5);
    expect(msg.createdAt).toBe('2026-02-26T10:00:00.000Z');
    expect(msg.personaId).toBe('p-1');
    expect(msg.personaName).toBe('User');
  });

  it('should pass through optional disambiguation fields', () => {
    const date = new Date('2026-02-26T10:00:00Z');
    const groups = [
      {
        channelEnvironment: {
          type: 'guild' as const,
          guild: { id: 'g-1', name: 'Server' },
          channel: { id: 'ch-1', name: 'general', type: 'text' },
        },
        messages: [
          {
            id: 'msg-2',
            role: MessageRole.Assistant,
            content: 'Response',
            tokenCount: 10,
            createdAt: date,
            personaId: 'p-1',
            personaName: 'User',
            discordUsername: 'alice#1234',
            personalityId: 'pers-1',
            personalityName: 'TestBot',
            channelId: 'ch-1',
            guildId: 'g-1',
            discordMessageId: ['d-2'],
          } as CrossChannelHistoryGroup['messages'][0],
        ],
      },
    ];

    const result = mapCrossChannelToApiFormat(groups);

    const msg = result[0].messages[0];
    expect(msg.discordUsername).toBe('alice#1234');
    expect(msg.personalityId).toBe('pers-1');
    expect(msg.personalityName).toBe('TestBot');
  });
});
