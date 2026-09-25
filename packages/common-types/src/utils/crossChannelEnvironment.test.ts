import { describe, it, expect } from 'vitest';
import { MessageRole } from '../constants/index.js';
import type { CrossChannelHistoryGroup } from '../types/conversationMessage.js';
import type { CrossChannelHistoryGroupEntry } from '../types/schemas/message.js';
import {
  applyCrossChannelRenderMode,
  buildFallbackEnvironment,
  mapCrossChannelToApiFormat,
} from './crossChannelEnvironment.js';

describe('buildFallbackEnvironment', () => {
  it('builds a DM environment when guildId is null', () => {
    expect(buildFallbackEnvironment('chan-1', null)).toEqual({
      type: 'dm',
      channel: { id: 'chan-1', name: 'Direct Message', type: 'dm' },
    });
  });

  it('builds an unknown guild environment when guildId is present', () => {
    expect(buildFallbackEnvironment('chan-1', 'guild-1')).toEqual({
      type: 'guild',
      guild: { id: 'guild-1', name: 'unknown-server' },
      channel: { id: 'chan-1', name: 'unknown-channel', type: 'text' },
    });
  });
});

describe('mapCrossChannelToApiFormat', () => {
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

  it('forwards discordMessageId, isForwarded, and messageMetadata.referencedMessages', () => {
    const date = new Date('2026-02-26T10:00:00Z');
    const groups = [
      {
        channelEnvironment: {
          type: 'dm' as const,
          channel: { id: 'ch-3', name: 'DM', type: 'dm' },
        },
        messages: [
          {
            id: 'msg-3',
            role: MessageRole.User,
            content: 'Quoting something',
            tokenCount: 5,
            createdAt: date,
            personaId: 'p-1',
            channelId: 'ch-3',
            guildId: null,
            discordMessageId: ['d-3'],
            isForwarded: true,
            messageMetadata: {
              referencedMessages: [
                {
                  discordMessageId: 'd-quoted',
                  authorUsername: 'bob',
                  authorDisplayName: 'Bob',
                  content: 'original',
                  timestamp: '2026-02-26T09:00:00.000Z',
                  locationContext: '#general',
                },
              ],
            },
          } as CrossChannelHistoryGroup['messages'][0],
        ],
      },
    ];

    const result = mapCrossChannelToApiFormat(groups);

    const msg = result[0].messages[0];
    expect(msg.discordMessageId).toEqual(['d-3']);
    expect(msg.isForwarded).toBe(true);
    expect(msg.messageMetadata).toEqual({
      referencedMessages: [
        {
          discordMessageId: 'd-quoted',
          authorUsername: 'bob',
          authorDisplayName: 'Bob',
          content: 'original',
          timestamp: '2026-02-26T09:00:00.000Z',
          locationContext: '#general',
        },
      ],
    });
  });

  it('maps absent messageMetadata/isForwarded to undefined (absent stays absent)', () => {
    const date = new Date('2026-02-26T10:00:00Z');
    const groups = [
      {
        channelEnvironment: {
          type: 'dm' as const,
          channel: { id: 'ch-4', name: 'DM', type: 'dm' },
        },
        messages: [
          {
            id: 'msg-4',
            role: MessageRole.User,
            content: 'No metadata here',
            tokenCount: 5,
            createdAt: date,
            personaId: 'p-1',
            channelId: 'ch-4',
            guildId: null,
            discordMessageId: ['d-4'],
          } as CrossChannelHistoryGroup['messages'][0],
        ],
      },
    ];

    const result = mapCrossChannelToApiFormat(groups);

    const msg = result[0].messages[0];
    expect(msg.isForwarded).toBeUndefined();
    expect(msg.messageMetadata).toBeUndefined();
  });
});

describe('applyCrossChannelRenderMode', () => {
  const dmEnvironment = {
    type: 'dm' as const,
    channel: { id: 'ch-1', name: 'DM', type: 'dm' },
  };

  function makeGroup(
    channelId: string,
    messages: CrossChannelHistoryGroupEntry['messages']
  ): CrossChannelHistoryGroupEntry {
    return {
      channelEnvironment: {
        ...dmEnvironment,
        channel: { ...dmEnvironment.channel, id: channelId },
      },
      messages,
    };
  }

  it("mode 'both' returns the same array and group references (no copy, no reorder)", () => {
    const groups: CrossChannelHistoryGroupEntry[] = [
      makeGroup('ch-1', [{ role: MessageRole.User, content: 'hi' }]),
    ];

    const result = applyCrossChannelRenderMode(groups, 'both');

    expect(result).toBe(groups);
    expect(result[0]).toBe(groups[0]);
  });

  it("mode 'user-only' keeps only the user rows, in order, preserving channelEnvironment", () => {
    const groups: CrossChannelHistoryGroupEntry[] = [
      makeGroup('ch-1', [
        { role: MessageRole.User, content: 'user-1' },
        { role: MessageRole.Assistant, content: 'assistant-1' },
        { role: MessageRole.User, content: 'user-2' },
        { role: MessageRole.Assistant, content: 'assistant-2' },
      ]),
    ];

    const result = applyCrossChannelRenderMode(groups, 'user-only');

    expect(result).toHaveLength(1);
    expect(result[0].channelEnvironment).toEqual(groups[0].channelEnvironment);
    expect(result[0].messages.map(m => m.content)).toEqual(['user-1', 'user-2']);
  });

  it("mode 'user-only' drops a group left with no messages (all-assistant channel)", () => {
    const groups: CrossChannelHistoryGroupEntry[] = [
      makeGroup('ch-1', [
        { role: MessageRole.Assistant, content: 'assistant-only-1' },
        { role: MessageRole.Assistant, content: 'assistant-only-2' },
      ]),
    ];

    const result = applyCrossChannelRenderMode(groups, 'user-only');

    expect(result).toHaveLength(0);
  });

  it("mode 'user-only' does not mutate the input group's messages array", () => {
    const original = [
      { role: MessageRole.User, content: 'user-1' },
      { role: MessageRole.Assistant, content: 'assistant-1' },
      { role: MessageRole.User, content: 'user-2' },
      { role: MessageRole.Assistant, content: 'assistant-2' },
    ];
    const groups: CrossChannelHistoryGroupEntry[] = [makeGroup('ch-1', original)];

    applyCrossChannelRenderMode(groups, 'user-only');

    expect(groups[0].messages).toHaveLength(4);
    expect(groups[0].messages).toBe(original);
  });

  it("mode 'user-only' with mixed groups keeps only the group that has user rows", () => {
    const groups: CrossChannelHistoryGroupEntry[] = [
      makeGroup('ch-1', [{ role: MessageRole.User, content: 'ch1-user' }]),
      makeGroup('ch-2', [{ role: MessageRole.Assistant, content: 'ch2-assistant' }]),
    ];

    const result = applyCrossChannelRenderMode(groups, 'user-only');

    expect(result).toHaveLength(1);
    expect(result[0].channelEnvironment.channel.id).toBe('ch-1');
  });
});
