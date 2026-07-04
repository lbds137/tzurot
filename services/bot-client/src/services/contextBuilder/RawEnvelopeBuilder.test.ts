import { describe, it, expect, vi } from 'vitest';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import {
  rawAssemblyInputsSchema,
  type RawAssemblyInputs,
} from '@tzurot/common-types/types/schemas/rawEnvelope';
import { MessageReferenceType, type Message } from 'discord.js';

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

// A native Discord forward: message.content is empty; the text lives in a
// messageSnapshot. `withReferenceType` toggles whether reference.type is the
// reliable Forward marker (Discord.js doesn't always populate it — the
// snapshot-size fallback must work on its own).
const makeForwardedMessage = (
  snapshotContent: string,
  opts: { withReferenceType?: boolean; topLevelContent?: string } = {}
) =>
  ({
    client: {},
    content: opts.topLevelContent ?? '',
    mentions: { users: new Map() },
    ...(opts.withReferenceType === true
      ? { reference: { type: MessageReferenceType.Forward } }
      : {}),
    messageSnapshots: { size: 1, first: () => ({ content: snapshotContent }) },
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

describe('captureRawExtendedContext', () => {
  it('deep-clones messages so later in-place persona resolution cannot leak in', () => {
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
  it('assembles the envelope: raw content, mention mapping, snapshot serialization, env map', () => {
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
    const raw = buildRawAssemblyInputs(makeMessage([], 'plain'), undefined, {
      rawAuthorDisplayName: 'Vladlena',
    });
    expect(raw?.rawAuthorDisplayName).toBe('Vladlena');
  });

  it('ships the raw guild surfaces: participant map, image list, active member info', () => {
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
    mockGetVoiceTranscript.mockReturnValue('the spoken words');

    const raw = buildRawAssemblyInputs(makeMessage([], ''), undefined);

    // A voice trigger is not a forward, so getEffectiveContent yields the empty
    // message.content — NOT the transcript (the worker re-transcribes instead).
    expect(raw?.rawMessageContent).toBe('');
    expect(raw?.rawRoutingTranscript).toBe('the spoken words');
  });

  // The worker's ContextAssembler re-derives the current turn SOLELY from
  // rawMessageContent. This matrix is the regression guard for the forward
  // content-loss bug: every trigger type must land its EFFECTIVE text here, or
  // the AI sees an empty turn (the "Hello" placeholder). Parameterized so a new
  // trigger type can't be added without a row — the gap that let the forward
  // case ship unnoticed.
  it.each([
    {
      trigger: 'normal text',
      message: () => makeMessage([], 'hello there'),
      expected: 'hello there',
    },
    {
      trigger: 'forward (reference.type=Forward)',
      message: () => makeForwardedMessage('forwarded body', { withReferenceType: true }),
      expected: 'forwarded body',
    },
    {
      trigger: 'forward (snapshot-size fallback, reference.type unset)',
      message: () => makeForwardedMessage('snapshot-only body'),
      expected: 'snapshot-only body',
    },
    {
      trigger: 'forward with non-empty top-level content (snapshot text wins)',
      message: () =>
        makeForwardedMessage('snapshot wins', {
          withReferenceType: true,
          topLevelContent: 'wrapper note that must NOT win',
        }),
      expected: 'snapshot wins',
    },
    {
      trigger: 'voice (empty content — worker re-transcribes, turn stays empty)',
      message: () => makeMessage([], ''),
      expected: '',
    },
  ])('rawMessageContent for $trigger → "$expected"', ({ message, expected }) => {
    expect(buildRawAssemblyInputs(message(), undefined)?.rawMessageContent).toBe(expected);
  });

  it('leaves rawRoutingTranscript absent for non-voice triggers', () => {
    mockGetVoiceTranscript.mockReturnValue(undefined);

    const raw = buildRawAssemblyInputs(makeMessage([], 'typed text'), undefined);

    expect(raw?.rawMessageContent).toBe('typed text');
    expect(raw?.rawRoutingTranscript).toBeUndefined();
  });

  it('omits rawMentionedUsers when the mentions collection is empty', () => {
    const raw = buildRawAssemblyInputs(makeMessage([], 'plain'), undefined);
    expect(raw?.rawMentionedUsers).toBeUndefined();
    expect(raw?.rawExtendedContextMessages).toBeUndefined();
  });
});

describe('buildRawAssemblyInputs — producer↔schema conformance', () => {
  // `rawAssemblyInputsSchema` IS the wire contract between this producer
  // (bot-client) and the worker's ContextAssembler consumer. These cases run the
  // REAL builder and assert its output is ACCEPTED by the schema — so a field the
  // builder emits (or a shape it changes) can never silently diverge from what the
  // worker validates against. This is the producer half of the consumer-driven
  // contract; the consumer half is ContextAssembler.test.ts / .component.test.ts.
  // Returns the Zod error message verbatim on failure (it names the offending
  // field), or null on conformance — the caller asserts `.toBeNull()` so the
  // assertion lives in the test body (vitest/expect-expect) AND failures stay legible.
  const conformanceError = (raw: RawAssemblyInputs): string | null => {
    const result = rawAssemblyInputsSchema.safeParse(raw);
    return result.success ? null : result.error.message;
  };

  it('minimal envelope (plain text, no extended context) conforms', () => {
    expect(
      conformanceError(buildRawAssemblyInputs(makeMessage([], 'just text'), undefined))
    ).toBeNull();
  });

  it('full envelope (mentions + extended context + reactors + env map) conforms', () => {
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
    expect(conformanceError(raw)).toBeNull();
  });

  it('envelope with guild surfaces + refs + channel/role mentions conforms', () => {
    const snapshot = {
      messages: [],
      extendedContextUsers: [],
      reactorUsers: [],
      participantGuildInfo: { 'discord:111': { roles: ['Admin'], displayColor: '#FF00FF' } },
      imageAttachments: [{ url: 'https://cdn/img.png', contentType: 'image/png', id: 'a1' }],
    };
    const raw = buildRawAssemblyInputs(makeMessage([], 'plain'), snapshot, {
      rawReferencedMessages: [],
      rawMentionedChannels: [{ channelId: '1', channelName: 'general', guildId: 'g1' }],
      rawMentionedRoles: [{ roleId: '2', roleName: 'mods', mentionable: false }],
      rawActiveGuildMemberInfo: { roles: ['Mod'], joinedAt: '2024-01-01T00:00:00.000Z' },
      rawAuthorDisplayName: 'Vladlena',
    });
    expect(conformanceError(raw)).toBeNull();
  });

  it('forwarded message envelope conforms', () => {
    // The fix routes a forward's snapshot text into rawMessageContent; assert
    // the resulting envelope still validates against the wire schema.
    expect(
      conformanceError(
        buildRawAssemblyInputs(
          makeForwardedMessage('the forwarded text', { withReferenceType: true }),
          undefined
        )
      )
    ).toBeNull();
  });
});
