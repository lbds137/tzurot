/**
 * Tests for MultiTagCoordinator — the orchestrator that fans N AI jobs out
 * in parallel and delivers responses in slot order once all complete.
 *
 * Strategy: mock every dep, drive the lifecycle manually. We're not testing
 * Redis, the chat manager, or the ordering service themselves — just that
 * the coordinator wires them together correctly.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Message } from 'discord.js';
import type { LLMGenerationResult, LoadedPersonality, TypingChannel } from '@tzurot/common-types';
import { MULTI_TAG } from '@tzurot/common-types';
import { MultiTagCoordinator, type StartFanOutInput } from './MultiTagCoordinator.js';
import type { ResolvedSlot } from './SlotResolver.js';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

function buildPersonality(name: string): LoadedPersonality {
  return {
    id: `id-${name}`,
    name,
    displayName: name,
    slug: name.toLowerCase(),
  } as unknown as LoadedPersonality;
}

function buildResolvedSlot(personality: LoadedPersonality): ResolvedSlot {
  return {
    personality,
    source: 'mention',
    isAutoResponse: false,
  };
}

function buildMessage(): Message {
  return {
    id: 'msg-source',
    author: { id: 'user-1' },
    guildId: 'guild-1',
    client: { user: { id: 'bot-1' } },
    reply: vi.fn(),
  } as unknown as Message;
}

function buildChannel(): TypingChannel {
  return { id: 'channel-1', sendTyping: vi.fn() } as unknown as TypingChannel;
}

describe('MultiTagCoordinator', () => {
  let chatManager: {
    submitChatJob: ReturnType<typeof vi.fn>;
  };
  let gatewayClient: {
    confirmDelivery: ReturnType<typeof vi.fn>;
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
  };
  let persistence: {
    putEntry: ReturnType<typeof vi.fn>;
    updateEntry: ReturnType<typeof vi.fn>;
    deleteEntry: ReturnType<typeof vi.fn>;
    markStale: ReturnType<typeof vi.fn>;
    isStale: ReturnType<typeof vi.fn>;
  };

  let coordinator: MultiTagCoordinator;

  beforeEach(() => {
    vi.useFakeTimers();
    chatManager = { submitChatJob: vi.fn() };
    gatewayClient = { confirmDelivery: vi.fn().mockResolvedValue(undefined) };
    jobTracker = { trackJob: vi.fn(), completeJob: vi.fn() };
    orderingService = {
      registerJob: vi.fn(),
      // Default: ordering service immediately invokes the deliverFn callback.
      // Real impl might buffer; tests that care about that override per-case.
      handleResult: vi.fn().mockImplementation(async (_chId, _jobId, _result, _time, deliverFn) => {
        await deliverFn();
      }),
    };
    slotDelivery = {
      deliverSuccess: vi.fn().mockResolvedValue({ chunkMessageIds: ['x'] }),
      deliverError: vi.fn().mockResolvedValue(undefined),
    };
    persistence = {
      putEntry: vi.fn().mockResolvedValue(undefined),
      updateEntry: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined),
      markStale: vi.fn().mockResolvedValue(undefined),
      isStale: vi.fn().mockResolvedValue(false),
    };

    coordinator = new MultiTagCoordinator({
      chatManager: chatManager as never,
      gatewayClient: gatewayClient as never,
      jobTracker: jobTracker as never,
      orderingService: orderingService as never,
      slotDelivery: slotDelivery as never,
      persistence: persistence as never,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fanOut(slots: ResolvedSlot[], opts: { jobIdsBySlotIndex?: string[] } = {}) {
    const input: StartFanOutInput = {
      message: buildMessage(),
      channel: buildChannel(),
      slots,
      content: 'hi everyone',
    };
    chatManager.submitChatJob.mockImplementation(async ({ personality }) => {
      const idx = slots.findIndex(s => s.personality.id === personality.id);
      const jobId = opts.jobIdsBySlotIndex?.[idx] ?? `job-${personality.name}`;
      return {
        kind: 'submitted',
        jobId,
        trackingContext: {
          kind: 'message',
          channel: input.channel,
          guildId: 'guild-1',
          clientId: 'bot-1',
          personality,
          personaId: `persona-${personality.name}`,
          userMessageTime: new Date(),
          userMessageContent: input.content,
          message: input.message,
        },
      };
    });
    return { input };
  }

  describe('startFanOut', () => {
    it('submits N jobs, registers them with JobTracker (skipping ordering), persists, registers group with ordering', async () => {
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b)]);

      await coordinator.startFanOut(input);

      expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
      expect(jobTracker.trackJob).toHaveBeenCalledTimes(2);
      // Both slot registrations skip ordering — coordinator owns the group entry
      expect(jobTracker.trackJob).toHaveBeenCalledWith(expect.any(String), expect.any(Object), {
        skipOrderingRegistration: true,
      });
      expect(persistence.putEntry).toHaveBeenCalledOnce();
      // Group entry registered with ordering using groupId as the ordering token
      expect(orderingService.registerJob).toHaveBeenCalledOnce();
      expect(coordinator.ownsJob('job-Alice')).toBe(true);
      expect(coordinator.ownsJob('job-Bob')).toBe(true);
      expect(coordinator.ownsJob('job-unrelated')).toBe(false);
    });

    it('skips denied slots silently', async () => {
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      // Alice submits, Bob is denied
      chatManager.submitChatJob.mockImplementation(async ({ personality }) => {
        if (personality.id === 'id-Bob') {
          return { kind: 'denied', reason: 'denylist' };
        }
        return {
          kind: 'submitted',
          jobId: `job-${personality.name}`,
          trackingContext: {
            kind: 'message',
            personality,
            personaId: `p-${personality.name}`,
            userMessageTime: new Date(),
          },
        };
      });

      await coordinator.startFanOut({
        message: buildMessage(),
        channel: buildChannel(),
        slots: [buildResolvedSlot(a), buildResolvedSlot(b)],
        content: 'hi',
      });

      // Only Alice tracked
      expect(jobTracker.trackJob).toHaveBeenCalledTimes(1);
      expect(coordinator.ownsJob('job-Alice')).toBe(true);
      expect(coordinator.ownsJob('job-Bob')).toBe(false);
    });

    it('refuses fan-out after shutdown begins', async () => {
      await coordinator.beginShutdown();
      await coordinator.startFanOut({
        message: buildMessage(),
        channel: buildChannel(),
        slots: [buildResolvedSlot(buildPersonality('Alice'))],
        content: 'hi',
      });
      expect(chatManager.submitChatJob).not.toHaveBeenCalled();
    });

    it('no-ops on empty slot list', async () => {
      await coordinator.startFanOut({
        message: buildMessage(),
        channel: buildChannel(),
        slots: [],
        content: 'hi',
      });
      expect(chatManager.submitChatJob).not.toHaveBeenCalled();
      expect(persistence.putEntry).not.toHaveBeenCalled();
    });
  });

  describe('handleJobResult — buffering and ordered flush', () => {
    it('buffers a single slot result, then flushes when last slot arrives', async () => {
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b)]);
      await coordinator.startFanOut(input);

      const aliceResult: LLMGenerationResult = {
        requestId: 'r-a',
        success: true,
        content: 'Alice says hi',
      };
      const bobResult: LLMGenerationResult = {
        requestId: 'r-b',
        success: true,
        content: 'Bob says hi',
      };

      // First result arrives — coordinator buffers, doesn't flush yet
      await coordinator.handleJobResult('job-Alice', aliceResult);
      expect(slotDelivery.deliverSuccess).not.toHaveBeenCalled();
      expect(orderingService.handleResult).not.toHaveBeenCalled();

      // Second result completes the group — flush triggers
      await coordinator.handleJobResult('job-Bob', bobResult);

      // Delivery happens in slot order (Alice first, then Bob)
      expect(slotDelivery.deliverSuccess).toHaveBeenCalledTimes(2);
      const calls = slotDelivery.deliverSuccess.mock.calls;
      expect(calls[0][0].content).toBe('Alice says hi');
      expect(calls[1][0].content).toBe('Bob says hi');
      // Ordering service was handed the group entry
      expect(orderingService.handleResult).toHaveBeenCalledOnce();
      // Persistence cleanup
      expect(persistence.deleteEntry).toHaveBeenCalledOnce();
      // confirmDelivery for both slot jobIds
      expect(gatewayClient.confirmDelivery).toHaveBeenCalledWith('job-Alice');
      expect(gatewayClient.confirmDelivery).toHaveBeenCalledWith('job-Bob');
      // ownsJob is false after flush
      expect(coordinator.ownsJob('job-Alice')).toBe(false);
      expect(coordinator.ownsJob('job-Bob')).toBe(false);
    });

    it('delivers slot in textual order regardless of result arrival order', async () => {
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      const c = buildPersonality('Carol');
      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b), buildResolvedSlot(c)]);
      await coordinator.startFanOut(input);

      // Results arrive in REVERSE order (Carol → Bob → Alice)
      await coordinator.handleJobResult('job-Carol', {
        requestId: 'rc',
        success: true,
        content: 'C',
      });
      await coordinator.handleJobResult('job-Bob', {
        requestId: 'rb',
        success: true,
        content: 'B',
      });
      await coordinator.handleJobResult('job-Alice', {
        requestId: 'ra',
        success: true,
        content: 'A',
      });

      // Delivery still happens A, B, C
      const deliveredContent = slotDelivery.deliverSuccess.mock.calls.map(c => c[0].content);
      expect(deliveredContent).toEqual(['A', 'B', 'C']);
    });

    it('errored slots use deliverError but the group still flushes in order', async () => {
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b)]);
      await coordinator.startFanOut(input);

      await coordinator.handleJobResult('job-Alice', {
        requestId: 'ra',
        success: false,
        error: 'AI broke',
      } as LLMGenerationResult);
      await coordinator.handleJobResult('job-Bob', {
        requestId: 'rb',
        success: true,
        content: 'Bob OK',
      });

      // Alice errored — deliverError; Bob succeeded — deliverSuccess
      expect(slotDelivery.deliverError).toHaveBeenCalledOnce();
      expect(slotDelivery.deliverSuccess).toHaveBeenCalledOnce();
      expect(slotDelivery.deliverSuccess.mock.calls[0][0].content).toBe('Bob OK');
    });

    it('ignores results for unknown jobIds', async () => {
      const a = buildPersonality('Alice');
      const { input } = fanOut([buildResolvedSlot(a)]);
      await coordinator.startFanOut(input);

      await coordinator.handleJobResult('totally-unknown-job', {
        requestId: 'rx',
        success: true,
        content: 'x',
      });
      expect(slotDelivery.deliverSuccess).not.toHaveBeenCalled();
    });
  });

  describe('safety timeout', () => {
    it('flushes with timeout error after MULTI_TAG.COORDINATOR_TIMEOUT_MS if a slot never resolves', async () => {
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b)]);
      await coordinator.startFanOut(input);

      // Alice's result arrives; Bob's never does
      await coordinator.handleJobResult('job-Alice', {
        requestId: 'ra',
        success: true,
        content: 'A',
      });
      expect(slotDelivery.deliverSuccess).not.toHaveBeenCalled();

      // Advance past the safety timeout
      await vi.advanceTimersByTimeAsync(MULTI_TAG.COORDINATOR_TIMEOUT_MS + 100);

      // Group flushed: Alice via success path, Bob via error path
      expect(slotDelivery.deliverSuccess).toHaveBeenCalledOnce();
      expect(slotDelivery.deliverError).toHaveBeenCalledOnce();
    });
  });

  describe('beginShutdown', () => {
    it('marks all pending jobIds stale and clears in-memory state', async () => {
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      const c = buildPersonality('Carol');
      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b), buildResolvedSlot(c)]);
      await coordinator.startFanOut(input);

      // Bob already completed — should NOT be marked stale
      await coordinator.handleJobResult('job-Bob', {
        requestId: 'rb',
        success: true,
        content: 'B',
      });

      await coordinator.beginShutdown();

      expect(persistence.markStale).toHaveBeenCalledWith('job-Alice', 'job-Carol');
      expect(coordinator.ownsJob('job-Alice')).toBe(false);
      expect(coordinator.ownsJob('job-Carol')).toBe(false);
    });

    it('does not call markStale when no pending slots remain', async () => {
      await coordinator.beginShutdown();
      expect(persistence.markStale).not.toHaveBeenCalled();
    });
  });

  describe('isStale', () => {
    it('proxies to persistence', async () => {
      persistence.isStale.mockResolvedValue(true);
      expect(await coordinator.isStale('foo')).toBe(true);
      expect(persistence.isStale).toHaveBeenCalledWith('foo');
    });
  });
});
