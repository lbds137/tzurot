import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType, type MessageContextMenuCommandInteraction } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { MessageContext } from '../../types.js';
import {
  CANT_REROLL_MESSAGE,
  PERSONA_CHANGED_MESSAGE,
  TRIGGER_GONE_MESSAGE,
  submitRerollTurn,
  type RerollPreflight,
} from './rerollTurn.js';

const mocks = vi.hoisted(() => ({
  rememberRerollJob: vi.fn(),
  logInfo: vi.fn(),
  buildContext: vi.fn(),
  trackJob: vi.fn(),
  generate: vi.fn(),
  runSlashChatGates: vi.fn(),
  resolveRerollTurnUser: vi.fn(),
  resolveChatLlmConfig: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: mocks.logInfo,
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});
vi.mock('../../redis.js', () => ({
  redis: { tag: 'redis' },
  redisService: { storeWebhookMessage: vi.fn() },
}));
vi.mock('./rerollGuard.js', () => ({ rememberRerollJob: mocks.rememberRerollJob }));
vi.mock('../serviceRegistry.js', () => ({
  getMessageContextBuilder: () => ({ buildContext: mocks.buildContext }),
  getJobTracker: () => ({ trackJob: mocks.trackJob }),
  getPersonalityLoader: vi.fn(),
  getConversationPersistence: vi.fn(),
}));
vi.mock('../../utils/gatewayServiceCalls.js', () => ({ generate: mocks.generate }));
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsForUser: vi.fn(() => ({ userClient: {} })),
  clientsFor: vi.fn(() => ({ userClient: {} })),
  getServiceClient: vi.fn(() => ({})),
}));
vi.mock('./slashChatGates.js', () => ({ runSlashChatGates: mocks.runSlashChatGates }));
vi.mock('./chatConfigResolution.js', () => ({
  resolveChatLlmConfig: mocks.resolveChatLlmConfig,
  buildExtendedContextSettings: vi.fn(() => ({ maxMessages: 50 })),
}));
vi.mock('./rerollTurnUser.js', () => ({ resolveRerollTurnUser: mocks.resolveRerollTurnUser }));
vi.mock('../../utils/messageCharacterLookup.js', () => ({
  createContextMenuDeferredContext: vi.fn((i: { user: unknown }) => ({ user: i.user })),
}));

const OWNER = { id: 'owner-discord' };
const CLICKER = { id: 'clicker-discord' };
const TRIGGER_ID = '111111111111111111';

const personality = { id: 'pers-1', name: 'Lila' } as unknown as LoadedPersonality;

function makePreflight(overrides: Partial<RerollPreflight> = {}): RerollPreflight {
  return {
    rowId: 'row-1',
    personalityId: 'pers-1',
    personaId: 'persona-1',
    ownerDiscordId: OWNER.id,
    incognito: false,
    content: 'old reply',
    discordMessageIds: ['222222222222222222', '333333333333333333'],
    trigger: {
      discordMessageId: TRIGGER_ID,
      content: 'stored trigger text',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    memoryPlan: { kind: 'remove', memoryIds: ['mem-1'], pendingIds: [] },
    ...overrides,
  } satisfies RerollPreflight;
}

type SubmitArgs = Omit<Parameters<typeof submitRerollTurn>[0], 'incognito'> & {
  incognito?: boolean;
};

/** The command computes the effective incognito; tests default it to the stored flag. */
function submit(args: SubmitArgs) {
  return submitRerollTurn({ incognito: args.preflight.incognito, ...args });
}

function makeChannel(fetch: ReturnType<typeof vi.fn>) {
  return {
    type: ChannelType.GuildText,
    id: 'chan-1',
    guild: { id: 'guild-1' },
    client: { user: { id: 'bot-1' } },
    messages: { fetch },
  };
}

function makeInteraction(channel: unknown): MessageContextMenuCommandInteraction {
  return {
    user: CLICKER,
    channel,
    guildId: 'guild-1',
    client: { user: { id: 'bot-1' } },
  } as unknown as MessageContextMenuCommandInteraction;
}

/** The context a normal (non-reroll) turn on the same trigger would build. */
function fakeContext(args: {
  anchorId: string;
  content: string;
  options: Record<string, unknown>;
}) {
  return {
    anchor: args.anchorId,
    content: args.content,
    extendedContext: args.options.extendedContext,
    botUserId: args.options.botUserId,
  } as unknown as MessageContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runSlashChatGates.mockResolvedValue(false);
  mocks.resolveRerollTurnUser.mockResolvedValue(OWNER);
  mocks.resolveChatLlmConfig.mockResolvedValue({});
  mocks.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });
  mocks.buildContext.mockImplementation(
    async (
      anchor: { id: string },
      _p: unknown,
      content: string,
      options: Record<string, unknown>
    ) => ({
      context: fakeContext({ anchorId: anchor.id, content, options }),
      personaId: 'persona-1',
    })
  );
});

describe('submitRerollTurn', () => {
  it('builds the triggered context as the owner, anchored on the fetched trigger with the stored content', async () => {
    const trigger = { id: TRIGGER_ID };
    const fetch = vi.fn().mockResolvedValue(trigger);
    const interaction = makeInteraction(makeChannel(fetch));

    const outcome = await submit({
      interaction,
      preflight: makePreflight(),
      personality,
      attemptId: 'attempt-1',
    });

    expect(outcome).toEqual({ kind: 'submitted', attemptId: 'attempt-1' });
    expect(fetch).toHaveBeenCalledWith(TRIGGER_ID);
    // The billed/persona user crossing into buildContext is the persona owner, not the clicker.
    expect(mocks.buildContext).toHaveBeenCalledWith(
      trigger,
      personality,
      'stored trigger text',
      expect.objectContaining({ overrideUser: OWNER, incognito: false })
    );
    const options = mocks.buildContext.mock.calls[0][3] as Record<string, unknown>;
    expect(options.isWeighInMode).toBeUndefined();
    expect(options.excludeDiscordMessageIds).toBeUndefined();
  });

  it('seam: the job context is what buildContext returned plus only reroll, trigger id and incognito', async () => {
    const built = { marker: 'built-by-buildContext', extendedContext: { maxMessages: 50 } };
    mocks.buildContext.mockResolvedValue({
      context: structuredClone(built) as unknown as MessageContext,
      personaId: 'persona-1',
    });
    const fetch = vi.fn().mockResolvedValue({ id: TRIGGER_ID });

    await submit({
      interaction: makeInteraction(makeChannel(fetch)),
      preflight: makePreflight(),
      personality,
      attemptId: 'attempt-1',
    });

    // Independently written expectations: neither side is derived from the other.
    expect(mocks.buildContext.mock.calls[0][3]).toEqual({
      extendedContext: { maxMessages: 50 },
      botUserId: 'bot-1',
      overrideUser: OWNER,
      incognito: false,
    });
    expect(mocks.generate.mock.calls[0][1]).toEqual({
      ...built,
      incognito: false,
      triggerMessageId: TRIGGER_ID,
      reroll: {
        rowId: 'row-1',
        attemptId: 'attempt-1',
        historyBefore: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('uses the caller-supplied incognito, so a legacy row inferred incognito rerolls incognito', async () => {
    const fetch = vi.fn().mockResolvedValue({ id: TRIGGER_ID });

    await submit({
      interaction: makeInteraction(makeChannel(fetch)),
      preflight: makePreflight({ incognito: false }),
      personality,
      attemptId: 'attempt-1',
      incognito: true,
    });

    expect(mocks.buildContext.mock.calls[0][3]).toEqual(
      expect.objectContaining({ incognito: true })
    );
    expect((mocks.generate.mock.calls[0][1] as MessageContext).incognito).toBe(true);
  });

  describe('anonymity kind', () => {
    const rerollWith = async (preflightOverrides: object, incognito?: boolean) => {
      const fetch = vi.fn().mockResolvedValue({ id: TRIGGER_ID });
      await submit({
        interaction: makeInteraction(makeChannel(fetch)),
        preflight: makePreflight(preflightOverrides),
        personality,
        attemptId: 'attempt-1',
        ...(incognito !== undefined && { incognito }),
      });
      return {
        buildOptions: mocks.buildContext.mock.calls[0][3] as { incognito: boolean },
        context: mocks.generate.mock.calls[0][1] as MessageContext,
      };
    };

    it('session: keeps the persona (not anonymous) and tells the worker to skip the memory write', async () => {
      const { buildOptions, context } = await rerollWith({
        incognito: true,
        incognitoKind: 'session',
      });

      expect(buildOptions.incognito).toBe(false);
      expect(context.incognito).toBe(false);
      expect(context.reroll).toEqual(expect.objectContaining({ skipMemoryWrite: true }));
    });

    it('summon: runs anonymous and does not set skipMemoryWrite', async () => {
      const { buildOptions, context } = await rerollWith({
        incognito: true,
        incognitoKind: 'summon',
      });

      expect(buildOptions.incognito).toBe(true);
      expect(context.incognito).toBe(true);
      expect(context.reroll).not.toHaveProperty('skipMemoryWrite');
    });

    it('legacy incognito row with no kind falls back to anonymous', async () => {
      const { buildOptions, context } = await rerollWith({ incognito: true });

      expect(buildOptions.incognito).toBe(true);
      expect(context.incognito).toBe(true);
      expect(context.reroll).not.toHaveProperty('skipMemoryWrite');
    });

    it('a non-incognito row never sets skipMemoryWrite, whatever stale kind it carries', async () => {
      const { context } = await rerollWith({ incognito: false, incognitoKind: 'session' });

      expect(context.reroll).not.toHaveProperty('skipMemoryWrite');
    });

    it('a legacy-inferred incognito on a row stored non-incognito stays anonymous even with a session kind', async () => {
      const { buildOptions } = await rerollWith(
        { incognito: false, incognitoKind: 'session' },
        true
      );

      expect(buildOptions.incognito).toBe(true);
    });
  });

  it('runs the gates for the turn owner too, and a refusal blocks before generating', async () => {
    mocks.runSlashChatGates.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const fetch = vi.fn().mockResolvedValue({ id: TRIGGER_ID });

    const outcome = await submit({
      interaction: makeInteraction(makeChannel(fetch)),
      preflight: makePreflight(),
      personality,
      attemptId: 'attempt-1',
    });

    expect(outcome).toEqual({ kind: 'refused', message: null });
    expect(mocks.runSlashChatGates).toHaveBeenCalledTimes(2);
    const actors = mocks.runSlashChatGates.mock.calls.map(
      call => (call[0] as { user: { id: string } }).user.id
    );
    expect(actors).toEqual([CLICKER.id, OWNER.id]);
    expect(mocks.buildContext).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('runs the gates once when the clicker is the turn owner', async () => {
    mocks.resolveRerollTurnUser.mockResolvedValue(CLICKER);
    const fetch = vi.fn().mockResolvedValue({ id: TRIGGER_ID });

    await submit({
      interaction: makeInteraction(makeChannel(fetch)),
      preflight: makePreflight(),
      personality,
      attemptId: 'attempt-1',
    });

    expect(mocks.runSlashChatGates).toHaveBeenCalledTimes(1);
  });

  it('records the job so a result the tracker lost can still be undone', async () => {
    const fetch = vi.fn().mockResolvedValue({ id: TRIGGER_ID });

    await submit({
      interaction: makeInteraction(makeChannel(fetch)),
      preflight: makePreflight(),
      personality,
      attemptId: 'attempt-1',
    });

    expect(mocks.rememberRerollJob).toHaveBeenCalledWith({ tag: 'redis' }, 'job-1', {
      rowId: 'row-1',
      attemptId: 'attempt-1',
      routeKey: '222222222222222222',
      actorId: CLICKER.id,
      keepMemoryIds: ['mem-1'],
    });
  });

  it('still tracks the job when the post-submit log line throws', async () => {
    mocks.logInfo.mockImplementationOnce(() => {
      throw new Error('log sink failed');
    });
    const fetch = vi.fn().mockResolvedValue({ id: TRIGGER_ID });

    // The log line must really throw out of submit (so the test exercises the
    // failure path), and the tracker and the job record must already be in place.
    await expect(
      submit({
        interaction: makeInteraction(makeChannel(fetch)),
        preflight: makePreflight(),
        personality,
        attemptId: 'attempt-1',
      })
    ).rejects.toThrow('log sink failed');

    expect(mocks.logInfo).toHaveBeenCalledTimes(1);
    expect(mocks.trackJob).toHaveBeenCalledTimes(1);
    expect(mocks.trackJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ kind: 'reroll', attemptId: 'attempt-1', rowId: 'row-1' })
    );
    expect(mocks.rememberRerollJob).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      expect.objectContaining({ attemptId: 'attempt-1' })
    );
  });

  it('weigh-in reroll: synthetic anchor, owner identity, excludes the old reply ids, no historyBefore', async () => {
    const fetch = vi.fn();
    const preflight = makePreflight({ trigger: null, incognito: true });

    await submit({
      interaction: makeInteraction(makeChannel(fetch)),
      preflight,
      personality,
      attemptId: 'attempt-2',
    });

    expect(fetch).not.toHaveBeenCalled();
    const [anchor, , , options] = mocks.buildContext.mock.calls[0];
    expect((anchor as { id: string }).id).toBe('synthetic-weigh-in-anchor');
    expect(options).toEqual(
      expect.objectContaining({
        overrideUser: OWNER,
        isWeighInMode: true,
        excludeDiscordMessageIds: preflight.discordMessageIds,
        incognito: true,
      })
    );
    const submitted = mocks.generate.mock.calls[0][1] as { reroll: unknown; isWeighIn: boolean };
    expect(submitted.reroll).toEqual({ rowId: 'row-1', attemptId: 'attempt-2' });
    expect(submitted.isWeighIn).toBe(true);
  });

  it('tracks the job as a reroll with the attempt, row and preflight', async () => {
    const preflight = makePreflight();
    const interaction = makeInteraction(makeChannel(vi.fn().mockResolvedValue({ id: TRIGGER_ID })));

    await submit({ interaction, preflight, personality, attemptId: 'attempt-1' });

    expect(mocks.trackJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        kind: 'reroll',
        interaction,
        rowId: 'row-1',
        attemptId: 'attempt-1',
        preflight,
        personaId: 'persona-1',
      })
    );
  });

  it('refuses before generating when the trigger message is gone', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('Unknown Message'));

    const outcome = await submit({
      interaction: makeInteraction(makeChannel(fetch)),
      preflight: makePreflight(),
      personality,
      attemptId: 'a',
    });

    expect(outcome).toEqual({ kind: 'refused', message: TRIGGER_GONE_MESSAGE });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.trackJob).not.toHaveBeenCalled();
  });

  it('refuses before generating when the active persona changed since the reply', async () => {
    mocks.buildContext.mockResolvedValue({
      context: {} as MessageContext,
      personaId: 'persona-other',
    });

    const outcome = await submit({
      interaction: makeInteraction(makeChannel(vi.fn().mockResolvedValue({ id: TRIGGER_ID }))),
      preflight: makePreflight(),
      personality,
      attemptId: 'a',
    });

    expect(outcome).toEqual({ kind: 'refused', message: PERSONA_CHANGED_MESSAGE });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('refuses silently when a gate already replied', async () => {
    mocks.runSlashChatGates.mockResolvedValue(true);

    const outcome = await submit({
      interaction: makeInteraction(makeChannel(vi.fn())),
      preflight: makePreflight(),
      personality,
      attemptId: 'a',
    });

    expect(outcome).toEqual({ kind: 'refused', message: null });
    expect(mocks.buildContext).not.toHaveBeenCalled();
  });

  it('refuses when the persona owner cannot be resolved', async () => {
    mocks.resolveRerollTurnUser.mockResolvedValue(null);

    const outcome = await submit({
      interaction: makeInteraction(makeChannel(vi.fn())),
      preflight: makePreflight(),
      personality,
      attemptId: 'a',
    });

    expect(outcome).toEqual({ kind: 'refused', message: CANT_REROLL_MESSAGE });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('refuses in a channel type it cannot deliver to', async () => {
    const outcome = await submit({
      interaction: makeInteraction({ type: ChannelType.GuildVoice, id: 'v' }),
      preflight: makePreflight(),
      personality,
      attemptId: 'a',
    });

    expect(outcome).toEqual({ kind: 'refused', message: CANT_REROLL_MESSAGE });
  });
});
