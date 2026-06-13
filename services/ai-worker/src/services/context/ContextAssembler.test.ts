import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return { ...actual, createLogger: () => mockLogger };
});

import {
  MessageRole,
  type JobContext,
  type LoadedPersonality,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types';
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

  it('skips cross-channel for weigh-in jobs even when enabled', async () => {
    const deps = makeDeps();
    const assembler = new ContextAssembler(deps);
    const core = await assembler.assembleCore(makeJobContext({ isWeighIn: true }), PERSONALITY, {
      maxMessages: 30,
      crossChannelHistoryEnabled: true,
    } as ResolvedConfigOverrides);
    expect(core.crossChannelHistory).toBeUndefined();
    expect(deps.dataSource.getCrossChannelHistory).not.toHaveBeenCalled();
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
