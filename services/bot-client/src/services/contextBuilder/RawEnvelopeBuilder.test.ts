import { describe, it, expect, vi, afterEach } from 'vitest';
import { MessageRole, type ConversationMessage } from '@tzurot/common-types';
import type { Message } from 'discord.js';

const { mockGetVoiceTranscript } = vi.hoisted(() => ({
  mockGetVoiceTranscript: vi.fn((): string | undefined => undefined),
}));
vi.mock('../../processors/VoiceMessageProcessor.js', () => ({
  VoiceMessageProcessor: { getVoiceTranscript: mockGetVoiceTranscript },
}));

vi.mock('../CrossChannelHistoryFetcher.js', () => ({
  buildKnownChannelEnvironments: vi.fn(() => ({
    '999888777666555444': {
      type: 'guild',
      guild: { id: 'guild-1', name: 'Cached Guild' },
      channel: { id: '999888777666555444', name: 'cached-channel', type: 'GUILD_TEXT' },
    },
  })),
}));

import {
  buildRawAssemblyInputs,
  captureRawExtendedContext,
  toApiConversationMessage,
  toRawDiscordUser,
} from './RawEnvelopeBuilder.js';

const makeMessage = (
  mentions: { id: string; username: string; globalName?: string }[] = [],
  content = ''
) =>
  ({
    client: {},
    content,
    mentions: {
      users: new Map(mentions.map(m => [m.id, m])),
    },
  }) as unknown as Message;

const makeConversationMessage = (overrides: Partial<ConversationMessage> = {}) =>
  ({
    id: 'm1',
    role: MessageRole.User,
    content: 'hello',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    personaId: 'discord:111',
    discordUsername: 'alice',
    discordMessageId: ['m1'],
    channelId: 'chan-1',
    guildId: 'guild-1',
    ...overrides,
  }) as ConversationMessage;

afterEach(() => {
  delete process.env.CONTEXT_RAW_ENVELOPE;
});

describe('captureRawExtendedContext', () => {
  it('returns undefined when the envelope flag is off (no clone cost)', () => {
    expect(captureRawExtendedContext({ messages: [makeConversationMessage()] })).toBeUndefined();
  });

  it('deep-clones messages so later in-place persona resolution cannot leak in', () => {
    process.env.CONTEXT_RAW_ENVELOPE = 'true';
    const original = makeConversationMessage({ personaId: 'discord:111' });

    const snapshot = captureRawExtendedContext({
      messages: [original],
      extendedContextUsers: [{ discordId: '111', username: 'alice', isBot: false }],
      reactorUsers: undefined,
    });

    // Simulate resolveExtendedContextPersonaIds mutating the fetched message.
    original.personaId = 'resolved-uuid';

    expect(snapshot?.messages[0].personaId).toBe('discord:111');
    expect(snapshot?.extendedContextUsers).toHaveLength(1);
    expect(snapshot?.reactorUsers).toEqual([]);
  });

  it('deep-clones the guild map so later in-place key remapping cannot leak in', () => {
    process.env.CONTEXT_RAW_ENVELOPE = 'true';
    const liveGuildInfo: Record<string, { roles: string[] }> = {
      'discord:111': { roles: ['Admin'] },
    };

    const snapshot = captureRawExtendedContext({
      messages: [],
      extendedContextUsers: [],
      reactorUsers: [],
      participantGuildInfo: liveGuildInfo,
      imageAttachments: [{ url: 'https://cdn/img.png', contentType: 'image/png', id: 'a1' }],
    });

    // Simulate resolveExtendedContextPersonaIds remapping the live map's keys.
    liveGuildInfo['resolved-uuid'] = liveGuildInfo['discord:111'];
    delete liveGuildInfo['discord:111'];

    expect(snapshot?.participantGuildInfo).toEqual({ 'discord:111': { roles: ['Admin'] } });
    expect(snapshot?.imageAttachments).toHaveLength(1);
  });

  it('leaves guild map and attachments undefined when the fetch produced none', () => {
    process.env.CONTEXT_RAW_ENVELOPE = 'true';
    const snapshot = captureRawExtendedContext({
      messages: [],
      extendedContextUsers: [],
      reactorUsers: [],
    });
    expect(snapshot?.participantGuildInfo).toBeUndefined();
    expect(snapshot?.imageAttachments).toBeUndefined();
  });
});

describe('toRawDiscordUser', () => {
  it('falls back to username when displayName is absent and omits falsy isBot', () => {
    expect(toRawDiscordUser({ discordId: '1', username: 'alice', isBot: false })).toEqual({
      discordId: '1',
      username: 'alice',
      displayName: 'alice',
    });
    expect(
      toRawDiscordUser({ discordId: '2', username: 'bot', displayName: 'Bot', isBot: true })
    ).toEqual({ discordId: '2', username: 'bot', displayName: 'Bot', isBot: true });
  });
});

describe('toApiConversationMessage', () => {
  it('serializes createdAt to ISO and preserves attribution fields', () => {
    const api = toApiConversationMessage(
      makeConversationMessage({ personalityId: 'pers-1', personalityName: 'Lila' })
    );
    expect(api.createdAt).toBe('2026-06-01T00:00:00.000Z');
    expect(api.personalityId).toBe('pers-1');
    expect(api.discordMessageId).toEqual(['m1']);
  });
});

describe('buildRawAssemblyInputs', () => {
  it('returns undefined when the envelope flag is off', () => {
    expect(buildRawAssemblyInputs(makeMessage(), undefined)).toBeUndefined();
  });

  it('assembles the envelope: raw content, mention mapping, snapshot serialization, env map', () => {
    process.env.CONTEXT_RAW_ENVELOPE = 'true';
    const snapshot = {
      messages: [makeConversationMessage()],
      extendedContextUsers: [
        { discordId: '111', username: 'alice', displayName: 'Alice', isBot: false },
      ],
      reactorUsers: [{ discordId: '222', username: 'rea', isBot: true }],
    };

    const raw = buildRawAssemblyInputs(
      makeMessage(
        [{ id: '333', username: 'mention-target', globalName: 'Mention Target' }],
        '<@333> raw content'
      ),
      snapshot
    );

    expect(raw?.rawMessageContent).toBe('<@333> raw content');
    expect(raw?.rawMentionedUsers).toEqual([
      { discordId: '333', username: 'mention-target', displayName: 'Mention Target' },
    ]);
    expect(raw?.rawExtendedContextMessages?.[0].createdAt).toBe('2026-06-01T00:00:00.000Z');
    expect(raw?.rawExtendedContextUsers).toEqual([
      { discordId: '111', username: 'alice', displayName: 'Alice' },
    ]);
    expect(raw?.rawReactorUsers).toEqual([
      { discordId: '222', username: 'rea', displayName: 'rea', isBot: true },
    ]);
    expect(raw?.knownChannelEnvironments?.['999888777666555444']).toMatchObject({
      type: 'guild',
    });
  });

  it('carries the author display name for worker-side getOrCreateUser parity', () => {
    process.env.CONTEXT_RAW_ENVELOPE = 'true';
    const raw = buildRawAssemblyInputs(makeMessage([], 'plain'), undefined, {
      rawAuthorDisplayName: 'Vladlena',
    });
    expect(raw?.rawAuthorDisplayName).toBe('Vladlena');
  });

  it('ships the raw guild surfaces: participant map, image list, active member info', () => {
    process.env.CONTEXT_RAW_ENVELOPE = 'true';
    const snapshot = {
      messages: [],
      extendedContextUsers: [],
      reactorUsers: [],
      participantGuildInfo: { 'discord:111': { roles: ['Admin'], displayColor: '#FF00FF' } },
      imageAttachments: [{ url: 'https://cdn/img.png', contentType: 'image/png', id: 'a1' }],
    };

    const raw = buildRawAssemblyInputs(makeMessage([], 'plain'), snapshot, {
      rawActiveGuildMemberInfo: { roles: ['Mod'], joinedAt: '2024-01-01T00:00:00.000Z' },
    });

    expect(raw?.rawParticipantGuildInfo).toEqual({
      'discord:111': { roles: ['Admin'], displayColor: '#FF00FF' },
    });
    expect(raw?.rawExtendedContextImageAttachments).toEqual([
      { url: 'https://cdn/img.png', contentType: 'image/png', id: 'a1' },
    ]);
    expect(raw?.rawActiveGuildMemberInfo).toEqual({
      roles: ['Mod'],
      joinedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('passes reference and channel/role mention raws through', () => {
    process.env.CONTEXT_RAW_ENVELOPE = 'true';
    const raw = buildRawAssemblyInputs(makeMessage([], 'plain'), undefined, {
      rawReferencedMessages: [],
      rawMentionedChannels: [{ channelId: '1', channelName: 'general', guildId: 'g1' }],
      rawMentionedRoles: [{ roleId: '2', roleName: 'mods', mentionable: false }],
    });

    // Empty array preserved (extraction ran, found nothing) — not collapsed.
    expect(raw?.rawReferencedMessages).toEqual([]);
    expect(raw?.rawMentionedChannels?.[0].channelName).toBe('general');
    expect(raw?.rawMentionedRoles?.[0].roleName).toBe('mods');
  });

  it('captures Discord ground truth: empty content + dedicated routing transcript for voice', () => {
    process.env.CONTEXT_RAW_ENVELOPE = 'true';
    mockGetVoiceTranscript.mockReturnValue('the spoken words');

    const raw = buildRawAssemblyInputs(makeMessage([], ''), undefined);

    // rawMessageContent is message.content VERBATIM — not the transcript.
    expect(raw?.rawMessageContent).toBe('');
    expect(raw?.rawRoutingTranscript).toBe('the spoken words');
  });

  it('leaves rawRoutingTranscript absent for non-voice triggers', () => {
    process.env.CONTEXT_RAW_ENVELOPE = 'true';
    mockGetVoiceTranscript.mockReturnValue(undefined);

    const raw = buildRawAssemblyInputs(makeMessage([], 'typed text'), undefined);

    expect(raw?.rawMessageContent).toBe('typed text');
    expect(raw?.rawRoutingTranscript).toBeUndefined();
  });

  it('omits rawMentionedUsers when the mentions collection is empty', () => {
    process.env.CONTEXT_RAW_ENVELOPE = 'true';
    const raw = buildRawAssemblyInputs(makeMessage([], 'plain'), undefined);
    expect(raw?.rawMentionedUsers).toBeUndefined();
    expect(raw?.rawExtendedContextMessages).toBeUndefined();
  });
});
