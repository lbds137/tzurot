import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

import { MessageRole } from '@tzurot/common-types/constants/message';
import { type ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import { type JobContext } from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { rawAssemblyInputsSchema } from '@tzurot/common-types/types/schemas/rawEnvelope';
import { ContextAssembler, type ContextAssemblerDeps } from './ContextAssembler.js';
import type { ContextDataSource } from './types.js';

const PERSONALITY = { id: 'pers-1', name: 'Lila' } as LoadedPersonality;

function makeDeps(overrides: Partial<Record<string, unknown>> = {}): ContextAssemblerDeps {
  return {
    dataSource: {
      getChannelHistory: vi.fn().mockResolvedValue([]),
      getCrossChannelHistory: vi.fn().mockResolvedValue([]),
      getUserTimezone: vi.fn().mockResolvedValue('UTC'),
      getContextEpoch: vi.fn().mockResolvedValue(undefined),
      getMessageByDiscordId: vi.fn().mockResolvedValue(null),
      findUserByDiscordId: vi.fn().mockResolvedValue(null),
      getPersonalityNamesByIds: vi.fn().mockResolvedValue(new Map()),
      getUserIdentitiesByDiscordIds: vi.fn().mockResolvedValue(new Map()),
      ...(overrides.dataSource as object),
    } as unknown as ContextDataSource,
    userService: {
      getOrCreateUser: vi.fn().mockResolvedValue({ userId: 'internal-1' }),
      getOrCreateUsersInBatch: vi.fn().mockResolvedValue(new Map()),
      ...(overrides.userService as object),
    },
    personaResolver: {
      resolve: vi
        .fn()
        .mockResolvedValue({ config: { personaId: 'persona-1', preferredName: 'Vee' } }),
      ...(overrides.personaResolver as object),
    },
  } as unknown as ContextAssemblerDeps;
}

function makeJobContext(partial: Partial<JobContext> = {}): JobContext {
  return {
    userId: '123456789012345678',
    userName: 'lbds137',
    channelId: 'chan-1',
    rawAssemblyInputs: { rawMessageContent: 'hello' },
    ...partial,
  } as JobContext;
}

describe('ContextAssembler.assembleCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when the raw envelope is absent (assembler is envelope-only)', async () => {
    const assembler = new ContextAssembler(makeDeps());
    await expect(
      assembler.assembleCore(
        makeJobContext({ rawAssemblyInputs: undefined }),
        PERSONALITY,
        undefined
      )
    ).rejects.toThrow('rawAssemblyInputs missing');
  });

  it('throws when channelId is missing', async () => {
    const assembler = new ContextAssembler(makeDeps());
    await expect(
      assembler.assembleCore(makeJobContext({ channelId: undefined }), PERSONALITY, undefined)
    ).rejects.toThrow('channelId missing');
  });

  it('weigh-in: nulls the output persona AND applies no context-epoch cutoff', async () => {
    const epoch = new Date('2026-05-01T00:00:00Z');
    const deps = makeDeps({
      dataSource: { getContextEpoch: vi.fn().mockResolvedValue(epoch) },
    });
    const assembler = new ContextAssembler(deps);

    const core = await assembler.assembleCore(
      makeJobContext({ isWeighIn: true }),
      PERSONALITY,
      undefined
    );

    // Output persona is nulled for the anonymous poke...
    expect(core.activePersonaId).toBeNull();
    expect(core.activePersonaName).toBeNull();
    // ...and the persona-scoped STM-reset epoch is NOT applied: weigh-in is a
    // channel-scoped summon, so one user's personal /conversation reset must
    // not bound the shared channel history. The lookup is skipped entirely
    // (not just discarded) — no wasted query, no cutoff.
    expect(deps.personaResolver.resolve).toHaveBeenCalledWith('123456789012345678', 'pers-1');
    expect(deps.dataSource.getContextEpoch).not.toHaveBeenCalled();
    expect(core.contextEpoch).toBeUndefined();
  });

  it('incognito=false on a weigh-in job keeps the persona + applies the epoch', async () => {
    const epoch = new Date('2026-05-01T00:00:00Z');
    const deps = makeDeps({
      dataSource: { getContextEpoch: vi.fn().mockResolvedValue(epoch) },
    });
    const assembler = new ContextAssembler(deps);

    // isWeighIn drives the read-the-room framing; incognito=false makes the
    // summon PERSONAL — the persona attribution and the STM-reset epoch are
    // restored even though the framing stays weigh-in.
    const core = await assembler.assembleCore(
      makeJobContext({ isWeighIn: true, incognito: false }),
      PERSONALITY,
      undefined
    );

    expect(core.activePersonaId).toBe('persona-1');
    expect(core.activePersonaName).toBe('Vee');
    expect(deps.dataSource.getContextEpoch).toHaveBeenCalled();
    expect(core.contextEpoch).toEqual(epoch);
  });

  it('assembles the core surfaces: upsert, persona, timezone, epoch, history', async () => {
    const epoch = new Date('2026-05-01T00:00:00Z');
    const deps = makeDeps({
      dataSource: {
        getContextEpoch: vi.fn().mockResolvedValue(epoch),
        getChannelHistory: vi.fn().mockResolvedValue([
          {
            id: 'm1',
            role: MessageRole.User,
            content: 'hi',
            createdAt: new Date(),
            discordMessageId: ['d1'],
          },
        ]),
      },
    });
    const assembler = new ContextAssembler(deps);

    const core = await assembler.assembleCore(
      makeJobContext({
        rawAssemblyInputs: { rawMessageContent: 'hello', rawAuthorDisplayName: 'Vladlena' },
      }),
      PERSONALITY,
      { maxMessages: 30, maxAge: 7200 } as ResolvedConfigOverrides
    );

    expect(deps.userService.getOrCreateUser).toHaveBeenCalledWith(
      '123456789012345678',
      'lbds137',
      'Vladlena'
    );
    expect(deps.personaResolver.resolve).toHaveBeenCalledWith('123456789012345678', 'pers-1');
    // Epoch lookup uses the freshly-derived internal id + persona id.
    expect(deps.dataSource.getContextEpoch).toHaveBeenCalledWith(
      'internal-1',
      'pers-1',
      'persona-1'
    );
    // History hydration mirrors the bot-side dbLimit derivation + epoch + maxAge.
    expect(deps.dataSource.getChannelHistory).toHaveBeenCalledWith('chan-1', 30, epoch, 7200);

    expect(core.userInternalId).toBe('internal-1');
    expect(core.activePersonaId).toBe('persona-1');
    expect(core.activePersonaName).toBe('Vee');
    expect(core.userTimezone).toBe('UTC');
    expect(core.contextEpoch).toBe(epoch);
    expect(core.history).toHaveLength(1);
  });

  it('excludes the trigger message from the assembled history (it ships as the live turn)', async () => {
    // bot-client persists the trigger before submitting the job, so the channel
    // history fetch includes it. The worker must drop it so the message does not
    // appear both in the assembled history and as the current user turn.
    const deps = makeDeps({
      dataSource: {
        getChannelHistory: vi.fn().mockResolvedValue([
          {
            id: 'm-prior',
            role: MessageRole.User,
            content: 'earlier message',
            createdAt: new Date('2026-05-01T00:00:00Z'),
            discordMessageId: ['d-prior'],
          },
          {
            id: 'm-trigger',
            role: MessageRole.User,
            content: 'the message being answered',
            createdAt: new Date('2026-05-01T00:01:00Z'),
            discordMessageId: ['d-trigger'],
          },
        ]),
      },
    });
    const assembler = new ContextAssembler(deps);

    const core = await assembler.assembleCore(
      makeJobContext({ triggerMessageId: 'd-trigger' }),
      PERSONALITY,
      { maxMessages: 30, maxAge: 7200 } as ResolvedConfigOverrides
    );

    // Over-fetches limit+1 (31) so dropping the trigger still leaves a full
    // limit-deep window rather than limit-1.
    expect(deps.dataSource.getChannelHistory).toHaveBeenCalledWith('chan-1', 31, undefined, 7200);
    // Only the prior message survives; the trigger row is filtered out.
    expect(core.history).toHaveLength(1);
    expect(core.history[0].content).toBe('earlier message');
  });

  it('keeps history intact when the trigger is set but matches no row (no-match passthrough)', async () => {
    const deps = makeDeps({
      dataSource: {
        getChannelHistory: vi.fn().mockResolvedValue([
          {
            id: 'm-x',
            role: MessageRole.User,
            content: 'unrelated',
            createdAt: new Date('2026-05-01T00:00:00Z'),
            discordMessageId: ['d-other'],
          },
        ]),
      },
    });
    const assembler = new ContextAssembler(deps);

    const core = await assembler.assembleCore(
      makeJobContext({ triggerMessageId: 'd-trigger-not-present' }),
      PERSONALITY,
      undefined
    );

    // triggerMessageId is set but matches no row → nothing is filtered.
    expect(core.history).toHaveLength(1);
    expect(core.history[0].content).toBe('unrelated');
  });

  it('does not over-fetch (no limit+1) when no triggerMessageId is present', async () => {
    const deps = makeDeps();
    const assembler = new ContextAssembler(deps);

    await assembler.assembleCore(makeJobContext({ triggerMessageId: undefined }), PERSONALITY, {
      maxMessages: 30,
      maxAge: 7200,
    } as ResolvedConfigOverrides);

    // No trigger → plain `limit`, no +1.
    expect(deps.dataSource.getChannelHistory).toHaveBeenCalledWith('chan-1', 30, undefined, 7200);
  });

  it('keeps all history when no triggerMessageId is present', async () => {
    const deps = makeDeps({
      dataSource: {
        getChannelHistory: vi.fn().mockResolvedValue([
          {
            id: 'm-a',
            role: MessageRole.User,
            content: 'a',
            createdAt: new Date('2026-05-01T00:00:00Z'),
            discordMessageId: ['d-a'],
          },
        ]),
      },
    });
    const assembler = new ContextAssembler(deps);

    const core = await assembler.assembleCore(
      makeJobContext({ triggerMessageId: undefined }),
      PERSONALITY,
      undefined
    );

    expect(core.history).toHaveLength(1);
  });

  it('falls back to the username when rawAuthorDisplayName is absent', async () => {
    const deps = makeDeps();
    const assembler = new ContextAssembler(deps);

    await assembler.assembleCore(makeJobContext(), PERSONALITY, undefined);

    expect(deps.userService.getOrCreateUser).toHaveBeenCalledWith(
      '123456789012345678',
      'lbds137',
      'lbds137'
    );
  });

  it('throws when getOrCreateUser returns null', async () => {
    const deps = makeDeps({
      userService: { getOrCreateUser: vi.fn().mockResolvedValue(null) },
    });
    const assembler = new ContextAssembler(deps);

    await expect(assembler.assembleCore(makeJobContext(), PERSONALITY, undefined)).rejects.toThrow(
      'getOrCreateUser returned null'
    );
  });

  it('merges envelope extended context: batch upsert + REAL placeholder resolution + REAL merge', async () => {
    const dbRow = {
      id: 'db-1',
      role: MessageRole.User,
      content: 'older message',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      personaId: 'persona-9',
      discordMessageId: ['d-db'],
    };
    const deps = makeDeps({
      dataSource: { getChannelHistory: vi.fn().mockResolvedValue([dbRow]) },
      userService: {
        getOrCreateUser: vi.fn().mockResolvedValue({ userId: 'internal-1' }),
        // Batch maps the extended-context author to an internal UUID.
        getOrCreateUsersInBatch: vi.fn().mockResolvedValue(new Map([['555', 'internal-555']])),
      },
      personaResolver: {
        resolve: vi
          .fn()
          .mockResolvedValue({ config: { personaId: 'persona-555', preferredName: 'Ext' } }),
      },
    });
    const assembler = new ContextAssembler(deps);

    const core = await assembler.assembleCore(
      makeJobContext({
        rawAssemblyInputs: {
          rawMessageContent: 'hello',
          rawExtendedContextMessages: [
            {
              id: 'd-ext',
              role: MessageRole.User,
              content: 'extended message',
              createdAt: '2026-06-02T00:00:00.000Z',
              personaId: 'discord:555', // pre-resolution placeholder
              discordMessageId: ['d-ext'],
            },
          ],
          rawExtendedContextUsers: [
            { discordId: '555', username: 'extuser', displayName: 'Ext User' },
          ],
        },
      }),
      PERSONALITY,
      undefined
    );

    expect(deps.userService.getOrCreateUsersInBatch).toHaveBeenCalledWith([
      { discordId: '555', username: 'extuser', displayName: 'Ext User', isBot: false },
    ]);
    // Merged: db row + extended row, sorted oldest-first by the REAL merge.
    expect(core.history.map(m => m.id)).toEqual(['db-1', 'd-ext']);
    // The REAL shared resolver replaced the discord: placeholder with a UUID.
    const ext = core.history.find(m => m.id === 'd-ext');
    expect(ext?.personaId).toBe('persona-555');
    expect(ext?.createdAt).toBeInstanceOf(Date);
    // Wire shape lacks channelId/guildId; the assembler fills them from the
    // job (same-channel by construction) so assembled rows are structurally
    // complete ConversationMessages.
    expect(ext?.channelId).toBe('chan-1');
    expect(ext?.guildId).toBeNull();
  });

  it('leaves referencedMessages undefined when the envelope carries no raw references', async () => {
    const assembler = new ContextAssembler(makeDeps());
    const core = await assembler.assembleCore(makeJobContext(), PERSONALITY, undefined);
    expect(core.referencedMessages).toBeUndefined();
  });

  it('re-keys the raw guild map to persona UUIDs without mutating the envelope copy', async () => {
    // Models the real resolution chain the shared resolver walks:
    //   discordId '555' --getOrCreateUsersInBatch--> internal UUID 'internal-555'
    //   --personaResolver.resolve--> persona UUID 'persona-555'
    // so the guild map's `discord:555` key remaps to `persona-555`.
    const deps = makeDeps({
      userService: {
        getOrCreateUser: vi.fn().mockResolvedValue({ userId: 'internal-1' }),
        getOrCreateUsersInBatch: vi.fn().mockResolvedValue(new Map([['555', 'internal-555']])),
      },
      personaResolver: {
        resolve: vi
          .fn()
          .mockResolvedValue({ config: { personaId: 'persona-555', preferredName: 'Ext' } }),
      },
    });
    const assembler = new ContextAssembler(deps);
    const jobContext = makeJobContext({
      rawAssemblyInputs: {
        rawMessageContent: 'hello',
        rawExtendedContextMessages: [
          {
            id: 'd-ext',
            role: MessageRole.User,
            content: 'extended message',
            createdAt: '2026-06-02T00:00:00.000Z',
            personaId: 'discord:555',
            discordMessageId: ['d-ext'],
          },
        ],
        rawExtendedContextUsers: [
          { discordId: '555', username: 'extuser', displayName: 'Ext User' },
        ],
        rawParticipantGuildInfo: {
          'discord:555': { roles: ['Admin', 'Dev'], displayColor: '#FF00FF' },
        },
        rawActiveGuildMemberInfo: { roles: ['Mod'], joinedAt: '2024-01-01T00:00:00.000Z' },
      },
    });

    const core = await assembler.assembleCore(jobContext, PERSONALITY, undefined);

    // The REAL shared resolver re-keyed discord:555 → the resolved persona UUID.
    expect(core.participantGuildInfo).toEqual({
      'persona-555': { roles: ['Admin', 'Dev'], displayColor: '#FF00FF' },
    });
    // The envelope's own copy stays pristine (clone isolation).
    expect(jobContext.rawAssemblyInputs?.rawParticipantGuildInfo).toEqual({
      'discord:555': { roles: ['Admin', 'Dev'], displayColor: '#FF00FF' },
    });
    // The trigger user's guild info passes through unchanged.
    expect(core.activePersonaGuildInfo).toEqual({
      roles: ['Mod'],
      joinedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('leaves the guild surfaces undefined when the envelope carries no raw forms', async () => {
    const assembler = new ContextAssembler(makeDeps());
    const core = await assembler.assembleCore(makeJobContext(), PERSONALITY, undefined);
    expect(core.participantGuildInfo).toBeUndefined();
    expect(core.activePersonaGuildInfo).toBeUndefined();
  });

  it('preserves an EMPTY guild map (not undefined) when no extended-context messages merge', async () => {
    // ABSENT (undefined) vs EMPTY ({}) must survive the no-messages early
    // return: the ContextStep adopt-guard keys off the raw field's presence,
    // so collapsing {} → undefined here would clobber a valid empty payload.
    const assembler = new ContextAssembler(makeDeps());
    const core = await assembler.assembleCore(
      makeJobContext({
        rawAssemblyInputs: {
          rawMessageContent: 'hello',
          rawParticipantGuildInfo: {},
        },
      }),
      PERSONALITY,
      undefined
    );
    expect(core.participantGuildInfo).toEqual({});
  });

  it('enriches raw references: stubs against assembled history, DB transcripts for the rest', async () => {
    const historyRow = {
      id: 'db-1',
      role: MessageRole.User,
      content: 'already in history',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      discordMessageId: ['d-in-history'],
    };
    const deps = makeDeps({
      dataSource: {
        getChannelHistory: vi.fn().mockResolvedValue([historyRow]),
        // Transcript lookup for the voice reference.
        getMessageByDiscordId: vi.fn().mockResolvedValue({ content: 'db transcript' }),
      },
    });
    const assembler = new ContextAssembler(deps);

    const baseRef = {
      discordUserId: 'u1',
      authorUsername: 'a',
      authorDisplayName: 'A',
      embeds: '',
      timestamp: '2026-06-01T00:01:00.000Z',
      locationContext: '',
    };
    const core = await assembler.assembleCore(
      makeJobContext({
        rawAssemblyInputs: {
          rawMessageContent: 'hello',
          rawReferencedMessages: [
            { ...baseRef, referenceNumber: 1, discordMessageId: 'd-in-history', content: 'dup' },
            {
              ...baseRef,
              referenceNumber: 2,
              discordMessageId: 'd-voice',
              content: 'voice msg',
              attachments: [
                {
                  url: 'https://cdn/v.ogg',
                  contentType: 'audio/ogg',
                  name: 'v.ogg',
                  isVoiceMessage: true,
                },
              ],
            },
          ],
        },
      }),
      PERSONALITY,
      undefined,
      { referenceDedupNowMs: new Date('2026-06-01T00:01:30Z').getTime() }
    );

    expect(core.referencedMessages).toHaveLength(2);
    expect(core.referencedMessages?.[0].isDeduplicated).toBe(true);
    expect(core.referencedMessages?.[1].content).toBe(
      'voice msg\n\n[Voice transcript]: db transcript'
    );
    expect(deps.dataSource.getMessageByDiscordId).toHaveBeenCalledWith('d-voice');
  });

  it('rewrites mentions in the raw content through the REAL shared kernels', async () => {
    const deps = makeDeps({
      personaResolver: {
        resolve: vi
          .fn()
          .mockResolvedValue({ config: { personaId: 'persona-7', preferredName: 'Mentioned' } }),
      },
    });
    const assembler = new ContextAssembler(deps);

    const core = await assembler.assembleCore(
      makeJobContext({
        rawAssemblyInputs: {
          rawMessageContent: 'hi <@567890123456789012>',
          rawMentionedUsers: [
            { discordId: '567890123456789012', username: 'someone', displayName: 'Someone' },
          ],
        },
      }),
      PERSONALITY,
      undefined
    );

    expect(core.messageContent).toBe('hi @Mentioned');
    expect(core.mentionedPersonas).toEqual([{ personaId: 'persona-7', personaName: 'Mentioned' }]);
  });

  it('routes out-of-map mention ids through the dataSource DB fallback', async () => {
    const deps = makeDeps();
    const assembler = new ContextAssembler(deps);

    const core = await assembler.assembleCore(
      makeJobContext({
        rawAssemblyInputs: {
          // Mention id not present in rawMentionedUsers — DB fallback path.
          rawMessageContent: 'hi <@678901234567890123>',
          rawMentionedUsers: [],
        },
      }),
      PERSONALITY,
      undefined
    );

    expect(deps.dataSource.findUserByDiscordId).toHaveBeenCalledWith('678901234567890123');
    // Unknown user: the tag stays raw.
    expect(core.messageContent).toBe('hi <@678901234567890123>');
  });

  it('skips ALL content rewriting in weigh-in mode (no mention upserts)', async () => {
    const deps = makeDeps();
    const assembler = new ContextAssembler(deps);
    const content = 'hi <@567890123456789012>';

    const core = await assembler.assembleCore(
      makeJobContext({
        isWeighIn: true,
        rawAssemblyInputs: {
          rawMessageContent: content,
          rawMentionedUsers: [
            { discordId: '567890123456789012', username: 'someone', displayName: 'Someone' },
          ],
        },
      }),
      PERSONALITY,
      undefined
    );

    expect(core.messageContent).toBe(content);
    expect(core.mentionedPersonas).toBeUndefined();
    // The anonymous-poke path must not create users for mentioned people —
    // only the author upsert from step 1 runs.
    expect(deps.userService.getOrCreateUser).toHaveBeenCalledTimes(1);
  });

  it('leaves crossChannelHistory undefined when the feature is disabled', async () => {
    const deps = makeDeps();
    const assembler = new ContextAssembler(deps);
    const core = await assembler.assembleCore(makeJobContext(), PERSONALITY, {
      maxMessages: 30,
      crossChannelHistoryEnabled: false,
    } as ResolvedConfigOverrides);
    expect(core.crossChannelHistory).toBeUndefined();
    expect(deps.dataSource.getCrossChannelHistory).not.toHaveBeenCalled();
  });

  it('skips cross-channel for a default weigh-in (incognito → null persona) even when enabled', async () => {
    // A bare weigh-in defaults to incognito, which nulls the persona; cross-channel
    // is persona-scoped, so it's skipped — because of the null persona, NOT the
    // weigh-in framing (a personal weigh-in still gets it — see below).
    const deps = makeDeps();
    const assembler = new ContextAssembler(deps);
    const core = await assembler.assembleCore(makeJobContext({ isWeighIn: true }), PERSONALITY, {
      maxMessages: 30,
      crossChannelHistoryEnabled: true,
    } as ResolvedConfigOverrides);
    expect(core.crossChannelHistory).toBeUndefined();
    expect(deps.dataSource.getCrossChannelHistory).not.toHaveBeenCalled();
  });

  it('skips cross-channel for an incognito chat (persona nulled) even when enabled', async () => {
    // Regression: /random with a message + incognito:true has
    // isWeighIn=false (a real chat turn) but incognito nulls the persona.
    // Cross-channel is persona-scoped, so it must be skipped rather than throwing
    // "[ContextAssembler] cross-channel enabled with a null persona".
    const deps = makeDeps();
    const assembler = new ContextAssembler(deps);
    const core = await assembler.assembleCore(makeJobContext({ incognito: true }), PERSONALITY, {
      maxMessages: 30,
      crossChannelHistoryEnabled: true,
    } as ResolvedConfigOverrides);
    expect(core.activePersonaId).toBeNull();
    expect(core.crossChannelHistory).toBeUndefined();
    expect(deps.dataSource.getCrossChannelHistory).not.toHaveBeenCalled();
  });

  it('enables cross-channel for a PERSONAL weigh-in (incognito=false keeps the persona)', async () => {
    // Cross-channel and the persona are a unit: a personal weigh-in
    // (isWeighIn=true, incognito=false) keeps its persona, so cross-channel runs.
    // The weigh-in framing does NOT disable it.
    const deps = makeDeps();
    const assembler = new ContextAssembler(deps);
    const core = await assembler.assembleCore(
      makeJobContext({ isWeighIn: true, incognito: false }),
      PERSONALITY,
      { maxMessages: 30, crossChannelHistoryEnabled: true } as ResolvedConfigOverrides
    );
    expect(core.activePersonaId).not.toBeNull();
    expect(deps.dataSource.getCrossChannelHistory).toHaveBeenCalled();
  });

  it('decorates cross-channel groups from the env map, falling back for cache misses', async () => {
    const knownEnv = {
      type: 'guild' as const,
      guild: { id: 'g1', name: 'Guild' },
      channel: { id: 'other-1', name: 'general', type: 'text' },
    };
    const row = {
      id: 'cc-1',
      role: MessageRole.User,
      content: 'cross msg',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      personaId: 'p1',
      channelId: 'other-1',
      guildId: 'g1',
      discordMessageId: ['d-cc'],
    };
    const deps = makeDeps({
      dataSource: {
        getCrossChannelHistory: vi.fn().mockResolvedValue([
          { channelId: 'other-1', guildId: 'g1', messages: [row] },
          { channelId: 'uncached-2', guildId: 'g1', messages: [] },
        ]),
      },
    });
    const assembler = new ContextAssembler(deps);

    const core = await assembler.assembleCore(
      makeJobContext({
        rawAssemblyInputs: {
          rawMessageContent: 'hello',
          knownChannelEnvironments: { 'other-1': knownEnv },
        },
      }),
      PERSONALITY,
      { maxMessages: 30, maxAge: 7200, crossChannelHistoryEnabled: true } as ResolvedConfigOverrides
    );

    expect(deps.dataSource.getCrossChannelHistory).toHaveBeenCalledWith({
      personaId: 'persona-1',
      personalityId: 'pers-1',
      excludeChannelId: 'chan-1',
      limit: 30,
      maxAgeSeconds: 7200,
      contextEpoch: undefined,
    });
    expect(core.crossChannelHistory).toHaveLength(2);
    // Cached channel: decorated with the envelope's environment.
    expect(core.crossChannelHistory?.[0].channelEnvironment).toEqual(knownEnv);
    // Wire serialization via the SHARED mapper (Date → ISO string).
    expect(core.crossChannelHistory?.[0].messages[0].createdAt).toBe('2026-06-01T00:00:00.000Z');
    // Cache miss: shared fallback environment.
    expect(core.crossChannelHistory?.[1].channelEnvironment).toEqual({
      type: 'guild',
      guild: { id: 'g1', name: 'unknown-server' },
      channel: { id: 'uncached-2', name: 'unknown-channel', type: 'text' },
    });
  });

  it('returns plain DB history when the envelope carries no extended context', async () => {
    const dbRow = {
      id: 'db-1',
      role: MessageRole.User,
      content: 'hi',
      createdAt: new Date(),
      discordMessageId: ['d1'],
    };
    const deps = makeDeps({
      dataSource: { getChannelHistory: vi.fn().mockResolvedValue([dbRow]) },
    });
    const assembler = new ContextAssembler(deps);

    const core = await assembler.assembleCore(makeJobContext(), PERSONALITY, undefined);

    expect(core.history).toEqual([dbRow]);
    expect(deps.userService.getOrCreateUsersInBatch).not.toHaveBeenCalled();
  });

  it('does not read the fields applyAssembledContext writes (idempotency invariant)', async () => {
    // applyAssembledContext (ContextStep) overwrites jobContext.referencedMessages /
    // mentionedPersonas / activePersonaId / userTimezone / etc. with assembled
    // output IN PLACE. That's only safe — and assemble+apply only idempotent —
    // if assembleCore never reads those written fields back. Guard it: poison
    // every written field with junk, then assert the assembled output is
    // byte-identical to a clean run. A future read-set expansion breaks here.
    const dbRow = {
      id: 'db-1',
      role: MessageRole.User,
      content: 'hi',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      discordMessageId: ['d1'],
    };
    const deps = makeDeps({
      dataSource: { getChannelHistory: vi.fn().mockResolvedValue([dbRow]) },
    });
    const assembler = new ContextAssembler(deps);

    const clean = await assembler.assembleCore(makeJobContext(), PERSONALITY, undefined);
    const poisoned = await assembler.assembleCore(
      makeJobContext({
        referencedMessages: [{ referenceNumber: 99, content: 'JUNK', authorName: 'X' }] as never,
        referencedChannels: [{ channelId: 'junk', channelName: 'junk' }] as never,
        mentionedPersonas: [{ personaId: 'junk', personaName: 'JUNK' }] as never,
        activePersonaId: 'JUNK-PERSONA',
        activePersonaName: 'JUNK',
        userTimezone: 'Junk/Zone',
        userInternalId: 'junk-internal',
        crossChannelHistory: [{ channelEnvironment: {}, messages: [] }] as never,
        participantGuildInfo: { junk: { roles: ['JUNK'] } } as never,
        activePersonaGuildInfo: { roles: ['JUNK'] } as never,
      }),
      PERSONALITY,
      undefined
    );

    expect(poisoned).toEqual(clean);
  });
});

describe('ContextAssembler.assembleCore — schema-coupled re-derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The cases above feed hand-built envelope objects. This one first round-trips a
  // realistic envelope through `rawAssemblyInputsSchema` (the EXACT wire shape
  // bot-client ships) and assembles from the PARSED result — proving the consumer
  // re-derives correctly from a schema-valid envelope, not just from ad-hoc TS
  // objects whose fields the schema might strip or coerce. Consumer half of the
  // producer↔schema↔consumer contract (producer half: RawEnvelopeBuilder.test.ts;
  // real-data half: ContextAssembler.component.test.ts).
  it('assembles core surfaces from a schema-validated envelope', async () => {
    const envelope = rawAssemblyInputsSchema.parse({
      rawMessageContent: 'hello from the wire',
      rawAuthorDisplayName: 'Vladlena',
      rawParticipantGuildInfo: { 'discord:111': { roles: ['Admin'] } },
      rawExtendedContextMessages: [
        {
          role: MessageRole.User,
          content: 'earlier message',
          createdAt: '2026-06-01T00:00:00.000Z',
          personaId: 'discord:111',
          discordUsername: 'alice',
          discordMessageId: ['m-ext-1'],
        },
      ],
      rawExtendedContextUsers: [{ discordId: '111', username: 'alice', displayName: 'Alice' }],
    });

    const deps = makeDeps({
      dataSource: {
        getChannelHistory: vi.fn().mockResolvedValue([]),
        getUserTimezone: vi.fn().mockResolvedValue('America/New_York'),
      },
      userService: {
        getOrCreateUser: vi.fn().mockResolvedValue({ userId: 'internal-1' }),
        getOrCreateUsersInBatch: vi.fn().mockResolvedValue(new Map([['111', { userId: 'u-111' }]])),
      },
    });
    const assembler = new ContextAssembler(deps);

    const core = await assembler.assembleCore(
      makeJobContext({ rawAssemblyInputs: envelope }),
      PERSONALITY,
      undefined
    );

    // Surfaces re-derived from the schema-valid envelope + faithful doubles.
    expect(core.userTimezone).toBe('America/New_York');
    expect(core.messageContent).toBe('hello from the wire');
    expect(core.activePersonaId).toBe('persona-1');
    // The extended-context message merged into the assembled history.
    expect(core.history.some(m => m.content === 'earlier message')).toBe(true);
    // The guild map survived re-keying (shared resolver remaps discord:* keys).
    expect(core.participantGuildInfo).toBeDefined();
    expect(Object.keys(core.participantGuildInfo ?? {})).toHaveLength(1);
  });

  it('assembles from a MINIMAL schema-valid envelope (content only)', async () => {
    // The leanest legal envelope: only rawMessageContent. The schema accepts it;
    // the consumer must too (history comes from DB alone, no extended context).
    const envelope = rawAssemblyInputsSchema.parse({ rawMessageContent: 'just text' });
    const core = await new ContextAssembler(makeDeps()).assembleCore(
      makeJobContext({ rawAssemblyInputs: envelope }),
      PERSONALITY,
      undefined
    );
    expect(core.messageContent).toBe('just text');
    expect(core.history).toEqual([]);
    expect(core.participantGuildInfo).toBeUndefined();
    expect(core.referencedMessages).toBeUndefined();
  });
});

describe('ContextAssembler — extended-context personality-name remap', () => {
  beforeEach(() => vi.clearAllMocks());

  function extCtx(messages: unknown[]): JobContext {
    return makeJobContext({
      rawAssemblyInputs: {
        rawMessageContent: 'hello',
        rawExtendedContextMessages: messages,
      },
    } as Partial<JobContext>);
  }

  it('remaps assistant attribution to the unique name via personalityId', async () => {
    const deps = makeDeps({
      dataSource: {
        getPersonalityNamesByIds: vi
          .fn()
          .mockResolvedValue(new Map([['pers-fallen', 'Fallen Emily']])),
      },
    });
    const ctx = extCtx([
      {
        role: MessageRole.Assistant,
        content: 'hi from the other one',
        personalityName: 'Emily', // webhook display name (shared, ambiguous)
        personalityId: 'pers-fallen',
        discordMessageId: ['d-1'],
      },
    ]);

    const core = await new ContextAssembler(deps).assembleCore(ctx, PERSONALITY, undefined);

    const msg = core.history.find(m => (m.discordMessageId ?? []).includes('d-1'));
    expect(msg?.personalityName).toBe('Fallen Emily');
    expect(deps.dataSource.getPersonalityNamesByIds).toHaveBeenCalledWith(['pers-fallen']);
  });

  it('keeps display-name attribution when the id is unresolved (registry miss)', async () => {
    const deps = makeDeps({
      dataSource: { getPersonalityNamesByIds: vi.fn().mockResolvedValue(new Map()) },
    });
    const ctx = extCtx([
      {
        role: MessageRole.Assistant,
        content: 'hi',
        personalityName: 'Emily',
        // no personalityId → registry miss; nothing to resolve
        discordMessageId: ['d-2'],
      },
    ]);

    const core = await new ContextAssembler(deps).assembleCore(ctx, PERSONALITY, undefined);

    const msg = core.history.find(m => (m.discordMessageId ?? []).includes('d-2'));
    expect(msg?.personalityName).toBe('Emily');
    expect(deps.dataSource.getPersonalityNamesByIds).not.toHaveBeenCalled();
  });

  it('remaps resolvable ids, leaves unresolvable ones and user messages untouched', async () => {
    // Mixed batch in one call: a resolvable assistant id, an unresolvable one
    // (deleted/evicted personality), and a user message. Exercises the loop's
    // skip-non-assistant path and the no-match keep-display-name path together.
    const deps = makeDeps({
      dataSource: {
        getPersonalityNamesByIds: vi
          .fn()
          .mockResolvedValue(new Map([['pers-known', 'Fallen Emily']])),
      },
    });
    const ctx = extCtx([
      {
        role: MessageRole.Assistant,
        content: 'resolvable',
        personalityName: 'Emily',
        personalityId: 'pers-known',
        discordMessageId: ['d-known'],
      },
      {
        role: MessageRole.Assistant,
        content: 'unresolvable',
        personalityName: 'Emily',
        personalityId: 'pers-gone', // not in the returned map
        discordMessageId: ['d-gone'],
      },
      {
        role: MessageRole.User,
        content: 'a human message',
        personaName: 'Lila',
        discordMessageId: ['d-user'],
      },
    ]);

    const core = await new ContextAssembler(deps).assembleCore(ctx, PERSONALITY, undefined);

    const known = core.history.find(m => (m.discordMessageId ?? []).includes('d-known'));
    const gone = core.history.find(m => (m.discordMessageId ?? []).includes('d-gone'));
    const user = core.history.find(m => (m.discordMessageId ?? []).includes('d-user'));
    expect(known?.personalityName).toBe('Fallen Emily'); // resolved → unique name
    expect(gone?.personalityName).toBe('Emily'); // unresolved → keeps display name
    expect(user?.personaName).toBe('Lila'); // user untouched
    // Both assistant ids are queried; the user message contributes none.
    expect(deps.dataSource.getPersonalityNamesByIds).toHaveBeenCalledWith([
      'pers-known',
      'pers-gone',
    ]);
  });

  it('does not remap user messages', async () => {
    const deps = makeDeps({
      dataSource: {
        getPersonalityNamesByIds: vi
          .fn()
          .mockResolvedValue(new Map([['pers-x', 'ShouldNotApply']])),
      },
    });
    const ctx = extCtx([
      {
        role: MessageRole.User,
        content: 'a human message',
        personaName: 'Lila',
        personalityId: 'pers-x', // present but role=user → must be ignored
        discordMessageId: ['d-3'],
      },
    ]);

    const core = await new ContextAssembler(deps).assembleCore(ctx, PERSONALITY, undefined);

    const msg = core.history.find(m => (m.discordMessageId ?? []).includes('d-3'));
    expect(msg?.personaName).toBe('Lila');
    expect(deps.dataSource.getPersonalityNamesByIds).not.toHaveBeenCalled();
  });
});

describe('ContextAssembler — relay-echo identity recovery', () => {
  beforeEach(() => vi.clearAllMocks());

  function extCtx(messages: unknown[]): JobContext {
    return makeJobContext({
      rawAssemblyInputs: {
        rawMessageContent: 'hello',
        rawExtendedContextMessages: messages,
      },
    } as Partial<JobContext>);
  }

  it('recovers the human behind a relay-echo (empty personaId) from the persisted row', async () => {
    const deps = makeDeps({
      dataSource: {
        getUserIdentitiesByDiscordIds: vi
          .fn()
          .mockResolvedValue(
            new Map([
              [
                'd-relay',
                { personaId: 'persona-uuid', personaName: 'Lila', discordUsername: 'lbds137' },
              ],
            ])
          ),
      },
    });
    const ctx = extCtx([
      {
        role: MessageRole.User,
        content: 'poke',
        personaName: 'Lila', // recovered from the **Lila:** prefix bot-side
        personaId: '', // bot-authored → resolver stripped it
        discordUsername: 'Rotzot · bot', // the bot's webhook name
        discordMessageId: ['d-relay'],
      },
    ]);

    const core = await new ContextAssembler(deps).assembleCore(ctx, PERSONALITY, undefined);

    // Integration: the recovery runs through assembleCore AFTER persona
    // resolution (the detailed branch cases are unit-tested in
    // relayEchoRecovery.test.ts).
    const msg = core.history.find(m => (m.discordMessageId ?? []).includes('d-relay'));
    expect(msg?.personaId).toBe('persona-uuid');
    expect(msg?.personaName).toBe('Lila');
    expect(msg?.discordUsername).toBe('lbds137'); // unified with the human's direct messages
    expect(deps.dataSource.getUserIdentitiesByDiscordIds).toHaveBeenCalledWith(['d-relay']);
  });
});

describe('ContextAssembler — extended-context voice transcript re-resolution', () => {
  beforeEach(() => vi.clearAllMocks());

  const voiceRef = {
    url: 'https://cdn/v.ogg',
    originalUrl: 'https://cdn/v.ogg',
    contentType: 'audio/ogg',
    isVoiceMessage: true,
    sourceDiscordMessageId: 'd-voice',
  };

  // An extended-context voice message (id d-voice) shipped with its voice ref;
  // `shipped` sets the transcript the bot already resolved (a cache HIT), absent
  // = the aged-out case the worker re-resolves.
  function voiceJobContext(shipped?: string[]): JobContext {
    return makeJobContext({
      rawAssemblyInputs: {
        rawMessageContent: 'hello',
        rawExtendedContextMessages: [
          {
            role: MessageRole.User,
            content: '[voice message]',
            discordMessageId: ['d-voice'],
            ...(shipped !== undefined ? { messageMetadata: { voiceTranscripts: shipped } } : {}),
          },
        ],
        rawExtendedContextVoiceMessages: [voiceRef],
      },
    });
  }

  function transcriptsOf(core: { history: ConversationMessage[] }): string[] | undefined {
    const msg = core.history.find(m => (m.discordMessageId ?? []).includes('d-voice'));
    return msg?.messageMetadata?.voiceTranscripts;
  }

  it('passes the transcript through from the DB row content without calling STT', async () => {
    const deps = makeDeps({
      dataSource: {
        getMessageByDiscordId: vi.fn().mockResolvedValue({ content: 'db transcript' }),
      },
    });
    const stt = vi.fn().mockResolvedValue('stt transcript');
    const core = await new ContextAssembler(deps).assembleCore(
      voiceJobContext(),
      PERSONALITY,
      undefined,
      {
        reTranscribeVoiceViaStt: stt,
      }
    );
    expect(transcriptsOf(core)).toEqual(['db transcript']);
    expect(stt).not.toHaveBeenCalled();
  });

  it('falls back to STT when the message is not in the DB', async () => {
    const deps = makeDeps({
      dataSource: { getMessageByDiscordId: vi.fn().mockResolvedValue(null) },
    });
    const stt = vi.fn().mockResolvedValue('stt transcript');
    const core = await new ContextAssembler(deps).assembleCore(
      voiceJobContext(),
      PERSONALITY,
      undefined,
      {
        reTranscribeVoiceViaStt: stt,
      }
    );
    expect(transcriptsOf(core)).toEqual(['stt transcript']);
    expect(stt).toHaveBeenCalledOnce();
  });

  it('leaves a message that already shipped a transcript untouched (no DB/STT lookup)', async () => {
    const getMessageByDiscordId = vi.fn().mockResolvedValue({ content: 'db transcript' });
    const deps = makeDeps({ dataSource: { getMessageByDiscordId } });
    const stt = vi.fn();
    const core = await new ContextAssembler(deps).assembleCore(
      voiceJobContext(['already here']),
      PERSONALITY,
      undefined,
      { reTranscribeVoiceViaStt: stt }
    );
    expect(transcriptsOf(core)).toEqual(['already here']);
    expect(getMessageByDiscordId).not.toHaveBeenCalled();
    expect(stt).not.toHaveBeenCalled();
  });

  it("skips the bot's own (assistant) voice output — no DB/STT lookup, no transcript", async () => {
    // The bot's voice output is TTS of its message text, so re-resolving a
    // transcript would be a wasted STT call and the chat-log renderer drops
    // assistant transcripts anyway. The skip must fire even though the message
    // is present in history (i.e. it's the assistant-role guard, not the
    // missing-target guard, that short-circuits).
    const getMessageByDiscordId = vi.fn().mockResolvedValue({ content: 'db transcript' });
    const deps = makeDeps({ dataSource: { getMessageByDiscordId } });
    const stt = vi.fn().mockResolvedValue('stt transcript');
    const ctx = makeJobContext({
      rawAssemblyInputs: {
        rawMessageContent: 'hello',
        rawExtendedContextMessages: [
          {
            role: MessageRole.Assistant,
            content: 'bot spoken reply',
            discordMessageId: ['d-voice'],
          },
        ],
        rawExtendedContextVoiceMessages: [voiceRef],
      },
    });

    const core = await new ContextAssembler(deps).assembleCore(ctx, PERSONALITY, undefined, {
      reTranscribeVoiceViaStt: stt,
    });

    const botMsg = core.history.find(m => (m.discordMessageId ?? []).includes('d-voice'));
    expect(botMsg?.role).toBe(MessageRole.Assistant);
    expect(botMsg?.messageMetadata?.voiceTranscripts).toBeUndefined();
    expect(getMessageByDiscordId).not.toHaveBeenCalled();
    expect(stt).not.toHaveBeenCalled();
  });

  it('degrades gracefully (no transcript) when both DB and STT miss', async () => {
    const deps = makeDeps({
      dataSource: { getMessageByDiscordId: vi.fn().mockResolvedValue(null) },
    });
    const stt = vi.fn().mockResolvedValue(null);
    const core = await new ContextAssembler(deps).assembleCore(
      voiceJobContext(),
      PERSONALITY,
      undefined,
      {
        reTranscribeVoiceViaStt: stt,
      }
    );
    expect(transcriptsOf(core)).toBeUndefined();
  });

  it('isolates a single ref failure — a throwing DB lookup degrades that ref, not the batch', async () => {
    // One ref's DB lookup throws (e.g. a connection error); the other resolves.
    // The throwing ref must degrade to no-transcript while the sibling still
    // gets its transcript — a single failure must NOT reject the Promise.all and
    // abort context assembly for the whole job.
    const okRef = { ...voiceRef, sourceDiscordMessageId: 'd-ok' };
    const throwRef = { ...voiceRef, sourceDiscordMessageId: 'd-throw' };
    const deps = makeDeps({
      dataSource: {
        getMessageByDiscordId: vi.fn(async (id: string) => {
          if (id === 'd-throw') {
            throw new Error('DB connection error');
          }
          return { content: 'db transcript ok' };
        }),
      },
    });
    const ctx = makeJobContext({
      rawAssemblyInputs: {
        rawMessageContent: 'hello',
        rawExtendedContextMessages: [
          { role: MessageRole.User, content: '[voice message]', discordMessageId: ['d-ok'] },
          { role: MessageRole.User, content: '[voice message]', discordMessageId: ['d-throw'] },
        ],
        rawExtendedContextVoiceMessages: [okRef, throwRef],
      },
    });

    const core = await new ContextAssembler(deps).assembleCore(ctx, PERSONALITY, undefined, {
      reTranscribeVoiceViaStt: vi.fn().mockResolvedValue(null),
    });

    // assembleCore resolved (no throw); sibling resolved, failed ref left transcript-less.
    const okMsg = core.history.find(m => (m.discordMessageId ?? []).includes('d-ok'));
    const throwMsg = core.history.find(m => (m.discordMessageId ?? []).includes('d-throw'));
    expect(okMsg?.messageMetadata?.voiceTranscripts).toEqual(['db transcript ok']);
    expect(throwMsg?.messageMetadata?.voiceTranscripts).toBeUndefined();
  });

  it('caps re-resolution to the newest refs when the count exceeds the cap', async () => {
    const N = 12; // > EXTENDED_CONTEXT_VOICE_REDERIVE_CAP (10)
    const ids = Array.from({ length: N }, (_, i) => `d-voice-${i}`); // collector order: oldest-first
    const deps = makeDeps({
      dataSource: {
        getMessageByDiscordId: vi.fn(async (id: string) => ({ content: `db-${id}` })),
      },
    });
    const core = await new ContextAssembler(deps).assembleCore(
      makeJobContext({
        rawAssemblyInputs: {
          rawMessageContent: 'hello',
          rawExtendedContextMessages: ids.map(id => ({
            role: MessageRole.User,
            content: '[voice message]',
            discordMessageId: [id],
          })),
          rawExtendedContextVoiceMessages: ids.map(id => ({
            ...voiceRef,
            sourceDiscordMessageId: id,
          })),
        },
      }),
      PERSONALITY,
      undefined,
      { reTranscribeVoiceViaStt: vi.fn() }
    );
    const transcriptFor = (id: string): string[] | undefined =>
      core.history.find(m => (m.discordMessageId ?? []).includes(id))?.messageMetadata
        ?.voiceTranscripts;
    // The two OLDEST refs are dropped by the cap...
    expect(transcriptFor('d-voice-0')).toBeUndefined();
    expect(transcriptFor('d-voice-1')).toBeUndefined();
    // ...the newest 10 are re-resolved.
    expect(transcriptFor('d-voice-2')).toEqual(['db-d-voice-2']);
    expect(transcriptFor('d-voice-11')).toEqual(['db-d-voice-11']);
  });

  it('skips a voice ref with no sourceDiscordMessageId (no DB/STT lookup)', async () => {
    const getMessageByDiscordId = vi.fn();
    const deps = makeDeps({ dataSource: { getMessageByDiscordId } });
    const stt = vi.fn();
    await new ContextAssembler(deps).assembleCore(
      makeJobContext({
        rawAssemblyInputs: {
          rawMessageContent: 'hello',
          rawExtendedContextMessages: [
            { role: MessageRole.User, content: 'x', discordMessageId: ['d1'] },
          ],
          rawExtendedContextVoiceMessages: [
            { url: 'https://cdn/v.ogg', contentType: 'audio/ogg', isVoiceMessage: true }, // no sourceDiscordMessageId
          ],
        },
      }),
      PERSONALITY,
      undefined,
      { reTranscribeVoiceViaStt: stt }
    );
    expect(getMessageByDiscordId).not.toHaveBeenCalled();
    expect(stt).not.toHaveBeenCalled();
  });
});
