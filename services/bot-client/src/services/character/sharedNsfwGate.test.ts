/**
 * Unit and wiring tests for sharedNsfwGate.
 *
 * The unit suite exercises `runNsfwGate` and `createSharedNsfwGate` directly.
 * The wiring suite runs a real `MultiTagCoordinator` over a real
 * `PersonalityChatManager` and real `nsfwVerification` helpers, mocking only
 * the external boundaries (`clientsForUser`, Redis, gateway service calls).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChannelType, type Message } from 'discord.js';
import type { TypingChannel } from '@tzurot/common-types/types/discord-types';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';
import { generate } from '../../utils/gatewayServiceCalls.js';
import {
  NSFW_VERIFICATION_CHECK_FAILED_MESSAGE,
  nsfwVerificationMessage,
} from '../../utils/nsfwVerification.js';
import { createSharedNsfwGate, runNsfwGate } from './sharedNsfwGate.js';
import { PersonalityChatManager, type SubmitChatJobResult } from './PersonalityChatManager.js';
import {
  MultiTagCoordinator,
  type MultiTagCoordinatorDeps,
  type StartFanOutInput,
} from '../MultiTagCoordinator.js';
import type { ResolvedSlot } from '../SlotResolver.js';

interface UserClientStub {
  actor: string;
  getNsfwStatus: ReturnType<typeof vi.fn>;
  verifyNsfw: ReturnType<typeof vi.fn>;
  resolveUserLlmConfig: ReturnType<typeof vi.fn>;
}

const clientsForUserMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsForUser: clientsForUserMock,
}));

vi.mock('../../redis.js', () => ({
  redis: {
    pipeline: vi.fn(() => ({
      rpush: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    })),
    del: vi.fn().mockResolvedValue(1),
    lrange: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../utils/gatewayServiceCalls.js', () => ({
  confirmDelivery: vi.fn().mockResolvedValue(undefined),
  setDmSessionPersonality: vi.fn().mockResolvedValue(undefined),
  updateDiagnosticResponseIds: vi.fn().mockResolvedValue(undefined),
  generate: vi.fn().mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' }),
}));

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({
      ...actual.getConfig(),
      BOT_MENTION_CHAR: '@',
      BOT_OWNER_ID: 'bot-owner-id',
    }),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

function createUserClientStub(actor = 'user-1'): UserClientStub {
  return {
    actor,
    getNsfwStatus: vi.fn(),
    verifyNsfw: vi.fn(),
    resolveUserLlmConfig: vi.fn().mockResolvedValue(
      makeOk({
        config: {
          model: 'test-model',
          provider: 'openrouter',
          maxMessages: 50,
          maxAge: null,
          maxImages: 10,
        },
        source: 'personality',
      })
    ),
  };
}

function buildPersonality(name: string): LoadedPersonality {
  return {
    id: `id-${name}`,
    name,
    displayName: name,
    slug: name.toLowerCase(),
    model: 'test-model',
    provider: 'openrouter',
  } as unknown as LoadedPersonality;
}

function buildResolvedSlot(personality: LoadedPersonality): ResolvedSlot {
  return {
    personality,
    source: 'mention',
    isAutoResponse: false,
  };
}

function buildChannel(overrides: { nsfw?: boolean; type?: ChannelType } = {}): TypingChannel & {
  send: ReturnType<typeof vi.fn>;
  nsfw: boolean;
  type: ChannelType;
} {
  return {
    id: 'channel-1',
    type: overrides.type ?? ChannelType.GuildText,
    nsfw: overrides.nsfw ?? false,
    sendTyping: vi.fn(),
    send: vi.fn().mockResolvedValue({
      id: 'confirm-msg-1',
      delete: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as TypingChannel & {
    send: ReturnType<typeof vi.fn>;
    nsfw: boolean;
    type: ChannelType;
  };
}

function buildMessage(
  overrides: {
    id?: string;
    channel?: ReturnType<typeof buildChannel>;
  } = {}
): Message & {
  channel: ReturnType<typeof buildChannel>;
  reply: ReturnType<typeof vi.fn>;
} {
  const channel = overrides.channel ?? buildChannel();
  const id = overrides.id ?? 'msg-source';
  return {
    id,
    author: { id: 'user-1', username: 'tester', bot: false },
    guildId: 'guild-1',
    channel,
    client: { user: { id: 'bot-1' } },
    reply: vi.fn().mockResolvedValue({ id: `reply-${id}`, channelId: channel.id }),
  } as unknown as Message & {
    channel: ReturnType<typeof buildChannel>;
    reply: ReturnType<typeof vi.fn>;
  };
}

describe('sharedNsfwGate (unit)', () => {
  let userClient: UserClientStub;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    userClient = createUserClientStub();
    clientsForUserMock.mockReturnValue({ userClient: asUserClient(userClient) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not run before the first call', () => {
    const message = buildMessage();

    createSharedNsfwGate(message);

    expect(clientsForUserMock).not.toHaveBeenCalled();
    expect(userClient.getNsfwStatus).not.toHaveBeenCalled();
    expect(userClient.verifyNsfw).not.toHaveBeenCalled();
    expect(message.reply).not.toHaveBeenCalled();
  });

  it('shares one in-flight run across concurrent callers', async () => {
    userClient.getNsfwStatus.mockResolvedValue(
      makeOk({ nsfwVerified: false, nsfwVerifiedAt: null })
    );
    const message = buildMessage();
    const gate = createSharedNsfwGate(message);

    const firstCall = gate();
    const secondCall = gate();
    const thirdCall = gate();
    const fourthCall = gate();

    expect(secondCall).toBe(firstCall);
    expect(thirdCall).toBe(firstCall);
    expect(fourthCall).toBe(firstCall);

    const results = await Promise.all([firstCall, secondCall, thirdCall, fourthCall]);

    expect(results).toEqual([false, false, false, false]);
    expect(userClient.getNsfwStatus).toHaveBeenCalledTimes(1);
    expect(message.reply).toHaveBeenCalledTimes(1);
  });

  it('runNsfwGate returns the decision and sends the confirmation only on wasNewVerification', async () => {
    // 1. Unverified in non-NSFW channel -> returns false, no confirmation
    userClient.getNsfwStatus.mockResolvedValueOnce(
      makeOk({ nsfwVerified: false, nsfwVerifiedAt: null })
    );
    const blockedMsg = buildMessage();
    await expect(runNsfwGate(blockedMsg)).resolves.toBe(false);
    expect(blockedMsg.channel.send).not.toHaveBeenCalled();

    // 2. Already verified in NSFW channel -> returns true, no confirmation
    userClient.verifyNsfw.mockResolvedValueOnce(
      makeOk({
        nsfwVerified: true,
        nsfwVerifiedAt: '2026-01-01T00:00:00.000Z',
        alreadyVerified: true,
      })
    );
    const alreadyVerifiedMsg = buildMessage({ channel: buildChannel({ nsfw: true }) });
    await expect(runNsfwGate(alreadyVerifiedMsg)).resolves.toBe(true);
    expect(alreadyVerifiedMsg.channel.send).not.toHaveBeenCalled();

    // 3. First-time verification in NSFW channel -> returns true, sends confirmation once
    userClient.verifyNsfw.mockResolvedValueOnce(
      makeOk({
        nsfwVerified: true,
        nsfwVerifiedAt: '2026-01-01T00:00:00.000Z',
        alreadyVerified: false,
      })
    );
    const firstVerifyMsg = buildMessage({ channel: buildChannel({ nsfw: true }) });
    await expect(runNsfwGate(firstVerifyMsg)).resolves.toBe(true);
    expect(firstVerifyMsg.channel.send).toHaveBeenCalledTimes(1);
    expect(firstVerifyMsg.channel.send).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });

  it('rejects every caller when the underlying gate run rejects', async () => {
    userClient.getNsfwStatus.mockRejectedValueOnce(new Error('unexpected client failure'));
    const message = buildMessage();
    const gate = createSharedNsfwGate(message);

    const p1 = gate();
    const p2 = gate();
    const p3 = gate();

    await Promise.all([
      expect(p1).rejects.toThrow('unexpected client failure'),
      expect(p2).rejects.toThrow('unexpected client failure'),
      expect(p3).rejects.toThrow('unexpected client failure'),
    ]);
    expect(userClient.getNsfwStatus).toHaveBeenCalledTimes(1);
  });
});

describe('MultiTagCoordinator + PersonalityChatManager NSFW gate (wiring)', () => {
  let userClient: UserClientStub;
  let mockContextBuilder: { buildContext: ReturnType<typeof vi.fn> };
  let mockConversationPersistence: { saveUserMessage: ReturnType<typeof vi.fn> };
  let mockDenylistCache: {
    isPersonalityDenied: ReturnType<typeof vi.fn>;
    isPersonalityMuted: ReturnType<typeof vi.fn>;
  };
  let jobTracker: {
    trackJob: ReturnType<typeof vi.fn>;
    completeJob: ReturnType<typeof vi.fn>;
  };
  let orderingService: {
    registerJob: ReturnType<typeof vi.fn>;
    handleResult: ReturnType<typeof vi.fn>;
  };
  let slotDelivery: {
    deliverSuccess: ReturnType<typeof vi.fn>;
    deliverError: ReturnType<typeof vi.fn>;
    deliverErrorNoPersist: ReturnType<typeof vi.fn>;
  };
  let persistence: {
    putEntry: ReturnType<typeof vi.fn>;
    updateEntry: ReturnType<typeof vi.fn>;
    deleteEntry: ReturnType<typeof vi.fn>;
    markStale: ReturnType<typeof vi.fn>;
    isStale: ReturnType<typeof vi.fn>;
    clearDMBackfillTried: ReturnType<typeof vi.fn>;
    markSyntheticTimeout: ReturnType<typeof vi.fn>;
  };
  let queue: {
    getJob: ReturnType<typeof vi.fn>;
  };
  let chatManager: PersonalityChatManager;
  let coordinator: MultiTagCoordinator;
  let fourSlots: ResolvedSlot[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    userClient = createUserClientStub();
    clientsForUserMock.mockReturnValue({ userClient: asUserClient(userClient) });

    mockContextBuilder = {
      buildContext: vi.fn().mockResolvedValue({
        context: {
          attachments: [],
          referencedMessages: [],
          conversationHistory: [],
        },
        personaId: 'persona-1',
        messageContent: 'hi everyone',
      }),
    };
    mockConversationPersistence = {
      saveUserMessage: vi.fn().mockResolvedValue(undefined),
    };
    mockDenylistCache = {
      isPersonalityDenied: vi.fn().mockReturnValue(false),
      isPersonalityMuted: vi.fn().mockReturnValue(false),
    };

    chatManager = new PersonalityChatManager({
      contextBuilder: mockContextBuilder as any,
      persistence: mockConversationPersistence as any,
      denylistCache: mockDenylistCache as any,
    });

    jobTracker = { trackJob: vi.fn(), completeJob: vi.fn() };
    orderingService = {
      registerJob: vi.fn(),
      handleResult: vi.fn().mockImplementation(async (_chId, _jobId, _result, _time, deliverFn) => {
        await deliverFn();
      }),
    };
    slotDelivery = {
      deliverSuccess: vi.fn().mockResolvedValue({ chunkMessageIds: ['x'] }),
      deliverError: vi.fn().mockResolvedValue(undefined),
      deliverErrorNoPersist: vi.fn().mockResolvedValue(undefined),
    };
    persistence = {
      putEntry: vi.fn().mockResolvedValue(undefined),
      updateEntry: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined),
      markStale: vi.fn().mockResolvedValue(undefined),
      isStale: vi.fn().mockResolvedValue(false),
      clearDMBackfillTried: vi.fn().mockResolvedValue(undefined),
      markSyntheticTimeout: vi.fn().mockResolvedValue(undefined),
    };
    queue = { getJob: vi.fn().mockResolvedValue(null) };

    coordinator = new MultiTagCoordinator({
      chatManager,
      jobTracker: jobTracker as unknown as MultiTagCoordinatorDeps['jobTracker'],
      orderingService: orderingService as unknown as MultiTagCoordinatorDeps['orderingService'],
      slotDelivery: slotDelivery as unknown as MultiTagCoordinatorDeps['slotDelivery'],
      persistence: persistence as unknown as MultiTagCoordinatorDeps['persistence'],
      queue: queue as unknown as MultiTagCoordinatorDeps['queue'],
    });

    fourSlots = ['Alice', 'Bob', 'Carol', 'Dave'].map(name =>
      buildResolvedSlot(buildPersonality(name))
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buildFanOutInput(
    message: ReturnType<typeof buildMessage>,
    slots: ResolvedSlot[] = fourSlots
  ): StartFanOutInput {
    return {
      message,
      channel: message.channel,
      slots,
      content: 'hi everyone',
      truncated: false,
      maxTags: 5,
    };
  }

  it('unverified user across 4 slots: replies once with verification prompt, checks once, suppresses generic notice', async () => {
    userClient.getNsfwStatus.mockResolvedValue(
      makeOk({ nsfwVerified: false, nsfwVerifiedAt: null })
    );
    const message = buildMessage();

    await coordinator.startFanOut(buildFanOutInput(message));

    expect(userClient.getNsfwStatus).toHaveBeenCalledTimes(1);
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.reply).toHaveBeenCalledWith(nsfwVerificationMessage());
    expect(message.reply).not.toHaveBeenCalledWith(
      expect.stringContaining('None of the tagged characters are currently available')
    );
    expect(jobTracker.trackJob).not.toHaveBeenCalled();
  });

  it('check-failed across 4 slots: replies once with NSFW_VERIFICATION_CHECK_FAILED_MESSAGE', async () => {
    userClient.getNsfwStatus.mockResolvedValue(makeErr(503, 'Gateway unavailable'));
    const message = buildMessage();

    await coordinator.startFanOut(buildFanOutInput(message));

    expect(userClient.getNsfwStatus).toHaveBeenCalledTimes(1);
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.reply).toHaveBeenCalledWith(NSFW_VERIFICATION_CHECK_FAILED_MESSAGE);
  });

  it('NSFW channel first-time verify across 4 slots: calls verifyNsfw once and sends confirmation once', async () => {
    userClient.verifyNsfw.mockResolvedValue(
      makeOk({
        nsfwVerified: true,
        nsfwVerifiedAt: '2026-01-01T00:00:00.000Z',
        alreadyVerified: false,
      })
    );
    // Stops processing after the gate; not part of the scenario.
    mockContextBuilder.buildContext.mockRejectedValue(new Error('stop after gate'));
    const nsfwMessage = buildMessage({ channel: buildChannel({ nsfw: true }) });

    await coordinator.startFanOut(buildFanOutInput(nsfwMessage));

    expect(userClient.verifyNsfw).toHaveBeenCalledTimes(1);
    expect(nsfwMessage.channel.send).toHaveBeenCalledTimes(1);
    expect(nsfwMessage.channel.send).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });

  it('all 4 slots MUTE-denylisted and user unverified: never calls check or message.reply', async () => {
    mockDenylistCache.isPersonalityDenied.mockReturnValue(true);
    mockDenylistCache.isPersonalityMuted.mockReturnValue(true);
    userClient.getNsfwStatus.mockResolvedValue(
      makeOk({ nsfwVerified: false, nsfwVerifiedAt: null })
    );
    const message = buildMessage();

    await coordinator.startFanOut(buildFanOutInput(message));

    expect(userClient.getNsfwStatus).not.toHaveBeenCalled();
    expect(message.reply).not.toHaveBeenCalled();
  });

  it('one slot denylisted and three not for an unverified user: replies once', async () => {
    mockDenylistCache.isPersonalityDenied.mockImplementation(
      (_userId: string, personalityId: string) => personalityId === 'id-Alice'
    );
    mockDenylistCache.isPersonalityMuted.mockImplementation(
      (_userId: string, personalityId: string) => personalityId === 'id-Alice'
    );
    userClient.getNsfwStatus.mockResolvedValue(
      makeOk({ nsfwVerified: false, nsfwVerifiedAt: null })
    );
    const message = buildMessage();

    await coordinator.startFanOut(buildFanOutInput(message));

    expect(userClient.getNsfwStatus).toHaveBeenCalledTimes(1);
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.reply).toHaveBeenCalledWith(nsfwVerificationMessage());
  });

  it('two successive startFanOut calls with different messages: replies once on each message', async () => {
    userClient.getNsfwStatus.mockResolvedValue(
      makeOk({ nsfwVerified: false, nsfwVerifiedAt: null })
    );
    const message1 = buildMessage({ id: 'msg-1' });
    const message2 = buildMessage({ id: 'msg-2' });

    await coordinator.startFanOut(buildFanOutInput(message1));
    await coordinator.startFanOut(buildFanOutInput(message2));

    expect(message1.reply).toHaveBeenCalledTimes(1);
    expect(message1.reply).toHaveBeenCalledWith(nsfwVerificationMessage());
    expect(message2.reply).toHaveBeenCalledTimes(1);
    expect(message2.reply).toHaveBeenCalledWith(nsfwVerificationMessage());
    expect(userClient.getNsfwStatus).toHaveBeenCalledTimes(2);
  });

  it('single submission through PersonalityChatManager.submitChatJob with no nsfwGate: unverified yields one reply', async () => {
    userClient.getNsfwStatus.mockResolvedValue(
      makeOk({ nsfwVerified: false, nsfwVerifiedAt: null })
    );
    const message = buildMessage();

    const result = await chatManager.submitChatJob({
      message,
      personality: buildPersonality('Alice'),
      content: 'hi',
    });

    expect(result).toEqual({
      kind: 'denied',
      reason: 'nsfw-blocked',
    } satisfies SubmitChatJobResult);
    expect(userClient.getNsfwStatus).toHaveBeenCalledTimes(1);
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.reply).toHaveBeenCalledWith(nsfwVerificationMessage());
  });

  it('a rejecting gate fails closed across all slots and submits nothing', async () => {
    userClient.getNsfwStatus.mockRejectedValue(new Error('unexpected client failure'));
    const message = buildMessage();

    await coordinator.startFanOut(buildFanOutInput(message));

    expect(userClient.getNsfwStatus).toHaveBeenCalledTimes(1);
    expect(jobTracker.trackJob).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(slotDelivery.deliverErrorNoPersist).toHaveBeenCalledTimes(4);
  });
});
