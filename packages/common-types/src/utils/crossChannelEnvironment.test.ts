import { describe, it, expect } from 'vitest';
import { MessageRole } from '../constants/index.js';
import type { CrossChannelHistoryGroup } from '../services/ConversationMessageMapper.js';
import { buildFallbackEnvironment, mapCrossChannelToApiFormat } from './crossChannelEnvironment.js';

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
});
