import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return { ...actual, createLogger: () => mockLogger };
});

import { MessageRole, type JobContext, type LoadedPersonality } from '@tzurot/common-types';
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
      { maxMessages: 30, maxAge: 7200 } as never
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
  });

  it('leaves referencedMessages undefined when the envelope carries no raw references', async () => {
    const assembler = new ContextAssembler(makeDeps());
    const core = await assembler.assembleCore(makeJobContext(), PERSONALITY, undefined);
    expect(core.referencedMessages).toBeUndefined();
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
});
