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
import type { TypingChannel } from '@tzurot/common-types/types/discord-types';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { MULTI_TAG } from '@tzurot/common-types/constants/message';
import {
  MultiTagCoordinator,
  type StartFanOutInput,
  type MultiTagCoordinatorDeps,
  type RuntimeEntry,
} from './MultiTagCoordinator.js';
import type { ResolvedSlot } from './SlotResolver.js';
import { SlotDeliveryService } from './SlotDeliveryService.js';
import type { DiscordResponseSender } from './DiscordResponseSender.js';
import type { ConversationPersistence } from './ConversationPersistence.js';
import { confirmDelivery, setDmSessionPersonality } from '../utils/gatewayServiceCalls.js';

vi.mock('../utils/gatewayServiceCalls.js', () => ({
  confirmDelivery: vi.fn(),
  setDmSessionPersonality: vi.fn(),
  // Called by the REAL SlotDeliveryService in the all-errored wiring test below.
  updateDiagnosticResponseIds: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
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

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-source',
    author: { id: 'user-1' },
    guildId: 'guild-1',
    client: { user: { id: 'bot-1' } },
    reply: vi.fn(),
    ...overrides,
  } as unknown as Message;
}

function buildDmMessage(): Message {
  return buildMessage({ guildId: null } as Partial<Message>);
}

function buildChannel(): TypingChannel {
  return { id: 'channel-1', sendTyping: vi.fn() } as unknown as TypingChannel;
}

describe('MultiTagCoordinator', () => {
  let chatManager: {
    submitChatJob: ReturnType<typeof vi.fn>;
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

  let coordinator: MultiTagCoordinator;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(confirmDelivery).mockResolvedValue(undefined);
    vi.mocked(setDmSessionPersonality).mockResolvedValue(undefined);
    chatManager = { submitChatJob: vi.fn() };
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
    // Default: job evicted from Redis — the safety-timeout re-poll treats
    // that as unrecoverable and falls through to the synthetic path, which
    // is the pre-re-poll behavior most tests assume.
    queue = { getJob: vi.fn().mockResolvedValue(null) };

    coordinator = new MultiTagCoordinator({
      chatManager: chatManager as unknown as MultiTagCoordinatorDeps['chatManager'],
      jobTracker: jobTracker as unknown as MultiTagCoordinatorDeps['jobTracker'],
      orderingService: orderingService as unknown as MultiTagCoordinatorDeps['orderingService'],
      slotDelivery: slotDelivery as unknown as MultiTagCoordinatorDeps['slotDelivery'],
      persistence: persistence as unknown as MultiTagCoordinatorDeps['persistence'],
      queue: queue as unknown as MultiTagCoordinatorDeps['queue'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fanOut(
    slots: ResolvedSlot[],
    opts: { jobIdsBySlotIndex?: string[]; message?: Message; truncated?: boolean } = {}
  ) {
    const input: StartFanOutInput = {
      message: opts.message ?? buildMessage(),
      channel: buildChannel(),
      slots,
      content: 'hi everyone',
      truncated: opts.truncated ?? false,
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
          guildId: input.message.guildId,
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
        truncated: false,
      });

      // Only Alice tracked
      expect(jobTracker.trackJob).toHaveBeenCalledTimes(1);
      expect(coordinator.ownsJob('job-Alice')).toBe(true);
      expect(coordinator.ownsJob('job-Bob')).toBe(false);
    });

    it('sends the unavailable notice (characters) when every slot is genuinely denied', async () => {
      const msg = buildMessage();
      chatManager.submitChatJob.mockResolvedValue({ kind: 'denied', reason: 'denylist' });

      await coordinator.startFanOut({
        message: msg,
        channel: buildChannel(),
        slots: [buildResolvedSlot(buildPersonality('Alice'))],
        content: 'hi',
        truncated: false,
      });

      expect(vi.mocked(msg.reply)).toHaveBeenCalledWith(
        expect.stringContaining('None of the tagged characters are currently available')
      );
    });

    it('delivers each errored character in-character (webhook), not a single system notice', async () => {
      const msg = buildMessage();
      // submitSlot catches the throw and synthesizes an 'errored' slot carrying
      // the personality + a synthetic result — the character speaks its own
      // error line via the webhook, never a bot-voice "something's slow" reply.
      chatManager.submitChatJob.mockRejectedValue(
        new Error('User-message persist failed via gateway: 0 Request timeout')
      );

      await coordinator.startFanOut({
        message: msg,
        channel: buildChannel(),
        slots: [
          buildResolvedSlot(buildPersonality('Alice')),
          buildResolvedSlot(buildPersonality('Bob')),
        ],
        content: 'hi',
        truncated: false,
      });

      // Per-persona in-character delivery — one no-persist webhook call each.
      expect(slotDelivery.deliverErrorNoPersist).toHaveBeenCalledTimes(2);
      const deliveredPersonalities = slotDelivery.deliverErrorNoPersist.mock.calls.map(
        c => c[2].personality.id
      );
      expect(deliveredPersonalities).toEqual(expect.arrayContaining(['id-Alice', 'id-Bob']));
      // No single bot-voice system notice.
      expect(vi.mocked(msg.reply)).not.toHaveBeenCalled();
    });

    it('errored speak in-character; denied stay silent (mixed batch)', async () => {
      const msg = buildMessage();
      chatManager.submitChatJob.mockImplementation(async ({ personality }) => {
        if (personality.id === 'id-Alice') {
          throw new Error('gateway timeout');
        }
        return { kind: 'denied', reason: 'denylist' };
      });

      await coordinator.startFanOut({
        message: msg,
        channel: buildChannel(),
        slots: [
          buildResolvedSlot(buildPersonality('Alice')), // errored → speaks
          buildResolvedSlot(buildPersonality('Bob')), // denied → silent
        ],
        content: 'hi',
        truncated: false,
      });

      // Only the errored character delivers; the denied one is silent.
      expect(slotDelivery.deliverErrorNoPersist).toHaveBeenCalledTimes(1);
      expect(slotDelivery.deliverErrorNoPersist.mock.calls[0][2].personality.id).toBe('id-Alice');
      // No all-denied system notice (an errored slot was present).
      expect(vi.mocked(msg.reply)).not.toHaveBeenCalled();
    });

    it('refuses fan-out after shutdown begins', async () => {
      await coordinator.beginShutdown();
      await coordinator.startFanOut({
        message: buildMessage(),
        channel: buildChannel(),
        slots: [buildResolvedSlot(buildPersonality('Alice'))],
        content: 'hi',
        truncated: false,
      });
      expect(chatManager.submitChatJob).not.toHaveBeenCalled();
    });

    it('no-ops on empty slot list', async () => {
      await coordinator.startFanOut({
        message: buildMessage(),
        channel: buildChannel(),
        slots: [],
        content: 'hi',
        truncated: false,
      });
      expect(chatManager.submitChatJob).not.toHaveBeenCalled();
      expect(persistence.putEntry).not.toHaveBeenCalled();
    });

    it('populates ownsJob BEFORE the putEntry roundtrip resolves (race-window guard)', async () => {
      // Race scenario: between `submitSlot` (registers the jobId with
      // JobTracker) and `putEntry` resolving, a result could arrive. If
      // `ownsJob` isn't populated yet, the result falls through to the
      // single-personality path via JobTracker.getContext — bypassing slot
      // ordering. The fix pre-populates jobToGroup/entries before the
      // persistence await; this test pins that ordering.
      const a = buildPersonality('Alice');
      let ownsJobInsidePersist: boolean | null = null;
      persistence.putEntry.mockImplementationOnce(async () => {
        ownsJobInsidePersist = coordinator.ownsJob('job-Alice');
      });

      const { input } = fanOut([buildResolvedSlot(a)]);
      await coordinator.startFanOut(input);

      // The check inside putEntry's mock saw ownsJob = true → the
      // in-memory state was populated before the roundtrip.
      expect(ownsJobInsidePersist).toBe(true);
      expect(coordinator.ownsJob('job-Alice')).toBe(true);
    });

    it('leaves no in-memory state when putEntry fails, registers slots per-job for ordering', async () => {
      // If Redis hiccups, we must not register the group in the in-memory
      // map (would orphan ownsJob → coordinator-blind recovery). But the
      // slots were submitted with `skipOrderingRegistration: true`
      // expecting the coordinator to register the GROUP — so we now have
      // to register each slot INDIVIDUALLY in the failure path or their
      // results bypass cross-message ordering entirely.
      persistence.putEntry.mockRejectedValueOnce(new Error('Redis down'));
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b)]);

      await coordinator.startFanOut(input);

      // Jobs were still submitted (uncancellable from here).
      expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
      // Coordinator state NOT registered (would orphan ownsJob).
      expect(coordinator.ownsJob('job-Alice')).toBe(false);
      expect(coordinator.ownsJob('job-Bob')).toBe(false);
      // Each slot IS registered with ordering individually (not the
      // group-level groupId). This preserves cross-message channel
      // ordering even though intra-fan-out slot order is lost.
      expect(orderingService.registerJob).toHaveBeenCalledTimes(2);
      expect(orderingService.registerJob).toHaveBeenCalledWith(
        input.channel.id,
        'job-Alice',
        expect.any(Date)
      );
      expect(orderingService.registerJob).toHaveBeenCalledWith(
        input.channel.id,
        'job-Bob',
        expect.any(Date)
      );
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
      expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('job-Alice');
      expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('job-Bob');
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

    it('continues to remaining slots when one slot delivery throws', async () => {
      // Slot delivery is best-effort per slot — a single slot's
      // sendResponse / persistence failure must not block the remaining
      // slots in the same burst from delivering. deliverGroup wraps each
      // slot in its own try/catch.
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      slotDelivery.deliverSuccess
        .mockRejectedValueOnce(new Error('Alice delivery exploded'))
        .mockResolvedValueOnce({ chunkMessageIds: ['bob-msg'] });

      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b)]);
      await coordinator.startFanOut(input);

      await coordinator.handleJobResult('job-Alice', {
        requestId: 'ra',
        success: true,
        content: 'A',
      });
      await coordinator.handleJobResult('job-Bob', {
        requestId: 'rb',
        success: true,
        content: 'B',
      });

      // Both attempts fired — Alice threw, Bob succeeded.
      expect(slotDelivery.deliverSuccess).toHaveBeenCalledTimes(2);
      // Group still cleaned up (confirmDelivery for both).
      expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('job-Alice');
      expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('job-Bob');
      // Entry deleted from in-memory map even though one slot threw.
      expect(coordinator.ownsJob('job-Alice')).toBe(false);
      expect(coordinator.ownsJob('job-Bob')).toBe(false);
    });

    it('routes empty-content "success" results through deliverError, not deliverSuccess', async () => {
      // Parity with MessageHandler: if a job comes back with success !== false
      // but empty/non-string content (rate-limit soft-fail, upstream weirdness),
      // the multi-tag path must still surface an error to the user instead of
      // letting deliverSuccess throw and the per-slot catch swallow it.
      const a = buildPersonality('Alice');
      const { input } = fanOut([buildResolvedSlot(a)]);
      await coordinator.startFanOut(input);

      // Alice's result is "successful" but content is empty
      await coordinator.handleJobResult('job-Alice', {
        requestId: 'ra',
        success: true,
        content: '',
      });

      expect(slotDelivery.deliverSuccess).not.toHaveBeenCalled();
      expect(slotDelivery.deliverError).toHaveBeenCalledOnce();
    });

    it('clears in-memory state even when orderingService.handleResult throws', async () => {
      // Regression guard: deliverGroup's tail does delivery-contingent
      // cleanup (confirmDelivery, persistence delete). The in-memory map
      // cleanup (entries, jobToGroup, flushingGroups) must run via
      // flushEntry's finally so that an orderingService throw doesn't
      // leak entries forever.
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      orderingService.handleResult.mockRejectedValueOnce(
        new Error('ordering service exploded before callback')
      );

      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b)]);
      await coordinator.startFanOut(input);

      // Push both results in — second triggers flush
      await coordinator.handleJobResult('job-Alice', {
        requestId: 'ra',
        success: true,
        content: 'A',
      });
      await expect(
        coordinator.handleJobResult('job-Bob', {
          requestId: 'rb',
          success: true,
          content: 'B',
        })
      ).rejects.toThrow('ordering service exploded');

      // deliverGroup never ran because handleResult threw before invoking it
      expect(slotDelivery.deliverSuccess).not.toHaveBeenCalled();
      // But in-memory state is cleaned up regardless
      expect(coordinator.ownsJob('job-Alice')).toBe(false);
      expect(coordinator.ownsJob('job-Bob')).toBe(false);
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

    it('writes a synthetic-timeout recovery marker for each timed-out slot', async () => {
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b)]);
      await coordinator.startFanOut(input);

      // Only Alice resolves; Bob times out.
      await coordinator.handleJobResult('job-Alice', {
        requestId: 'ra',
        success: true,
        content: 'A',
      });
      await vi.advanceTimersByTimeAsync(MULTI_TAG.COORDINATOR_TIMEOUT_MS + 100);

      // Marker written for the timed-out slot (Bob), not the delivered one (Alice).
      expect(persistence.markSyntheticTimeout).toHaveBeenCalledTimes(1);
      const [jobId, ctx] = persistence.markSyntheticTimeout.mock.calls[0];
      expect(jobId).toBe('job-Bob');
      expect(ctx).toMatchObject({
        personalitySlug: b.slug,
        recipientUserId: 'user-1', // buildMessage author id → entry.userId
        isAutoResponse: false,
      });
    });

    it("re-polls BullMQ at timeout and delivers a completed job's REAL result instead of a synthetic error", async () => {
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b)]);
      await coordinator.startFanOut(input);

      await coordinator.handleJobResult('job-Alice', {
        requestId: 'ra',
        success: true,
        content: 'A',
      });
      // Bob's completion event was lost, but the job itself finished — the
      // re-poll finds the returnvalue in BullMQ.
      queue.getJob.mockResolvedValue({
        getState: vi.fn().mockResolvedValue('completed'),
        returnvalue: { requestId: 'rb', success: true, content: 'B-recovered' },
      });

      await vi.advanceTimersByTimeAsync(MULTI_TAG.COORDINATOR_TIMEOUT_MS + 100);

      // Both slots deliver as successes; nothing synthetic.
      expect(queue.getJob).toHaveBeenCalledWith('job-Bob');
      expect(slotDelivery.deliverSuccess).toHaveBeenCalledTimes(2);
      expect(slotDelivery.deliverError).not.toHaveBeenCalled();
      expect(persistence.markSyntheticTimeout).not.toHaveBeenCalled();
      const deliveredContents = slotDelivery.deliverSuccess.mock.calls.map(
        call => (call[0] as { content: string }).content
      );
      expect(deliveredContents).toContain('B-recovered');
    });

    it("re-polls BullMQ at timeout and delivers a failed job's REAL failure reason", async () => {
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b)]);
      await coordinator.startFanOut(input);

      await coordinator.handleJobResult('job-Alice', {
        requestId: 'ra',
        success: true,
        content: 'A',
      });
      queue.getJob.mockResolvedValue({
        getState: vi.fn().mockResolvedValue('failed'),
        failedReason: 'model exploded',
      });

      await vi.advanceTimersByTimeAsync(MULTI_TAG.COORDINATOR_TIMEOUT_MS + 100);

      // Bob delivers through the error path with the authoritative reason —
      // no synthetic-timeout marker, because the outcome is real, not lost.
      expect(slotDelivery.deliverSuccess).toHaveBeenCalledTimes(1);
      expect(slotDelivery.deliverError).toHaveBeenCalledTimes(1);
      expect(persistence.markSyntheticTimeout).not.toHaveBeenCalled();
      const [, errorResult] = slotDelivery.deliverError.mock.calls[0];
      expect(errorResult).toMatchObject({ success: false, error: 'model exploded' });
    });

    it('still synthesizes a timeout for a job that is genuinely in flight at the deadline', async () => {
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b)]);
      await coordinator.startFanOut(input);

      await coordinator.handleJobResult('job-Alice', {
        requestId: 'ra',
        success: true,
        content: 'A',
      });
      // Job still active (e.g. a dead worker's unexpired lock, or a genuinely
      // slow job) — the safety window is the authoritative give-up point.
      queue.getJob.mockResolvedValue({
        getState: vi.fn().mockResolvedValue('active'),
      });

      await vi.advanceTimersByTimeAsync(MULTI_TAG.COORDINATOR_TIMEOUT_MS + 100);

      expect(slotDelivery.deliverSuccess).toHaveBeenCalledTimes(1);
      expect(slotDelivery.deliverError).toHaveBeenCalledTimes(1);
      expect(persistence.markSyntheticTimeout).toHaveBeenCalledTimes(1);
      expect(persistence.markSyntheticTimeout.mock.calls[0][0]).toBe('job-Bob');
    });
  });

  describe('DM session activation after flush', () => {
    it('writes the textually-last mention to DM session state when channel is a DM', async () => {
      const a = buildPersonality('Alice');
      const b = buildPersonality('Bob');
      // DM channel — message.guildId is null
      const { input } = fanOut([buildResolvedSlot(a), buildResolvedSlot(b)], {
        message: buildDmMessage(),
      });
      await coordinator.startFanOut(input);

      await coordinator.handleJobResult('job-Alice', {
        requestId: 'ra',
        success: true,
        content: 'A',
      });
      await coordinator.handleJobResult('job-Bob', {
        requestId: 'rb',
        success: true,
        content: 'B',
      });

      // Bob (slot 1, textually-last mention) becomes the new active session
      expect(vi.mocked(setDmSessionPersonality)).toHaveBeenCalledOnce();
      expect(vi.mocked(setDmSessionPersonality)).toHaveBeenCalledWith(
        input.channel.id,
        'bob' // slug
      );
    });

    it('does NOT write DM session state for guild-channel fan-outs', async () => {
      const a = buildPersonality('Alice');
      const { input } = fanOut([buildResolvedSlot(a)]);
      await coordinator.startFanOut(input);
      await coordinator.handleJobResult('job-Alice', {
        requestId: 'ra',
        success: true,
        content: 'A',
      });
      expect(vi.mocked(setDmSessionPersonality)).not.toHaveBeenCalled();
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

  describe('staleCheckNeeded fast-path flag', () => {
    it('defaults to false before any stale marking', () => {
      expect(coordinator.staleCheckNeeded).toBe(false);
    });

    it('flips to true after beginShutdown marks any pending jobIds', async () => {
      const a = buildPersonality('Alice');
      const { input } = fanOut([buildResolvedSlot(a)]);
      await coordinator.startFanOut(input);

      expect(coordinator.staleCheckNeeded).toBe(false);
      await coordinator.beginShutdown();
      expect(coordinator.staleCheckNeeded).toBe(true);
    });

    it('stays false when shutdown finds nothing to mark stale', async () => {
      await coordinator.beginShutdown();
      expect(coordinator.staleCheckNeeded).toBe(false);
    });

    it('flips to true via noteRecoveryMarkedStale (recovery hook)', () => {
      expect(coordinator.staleCheckNeeded).toBe(false);
      coordinator.noteRecoveryMarkedStale();
      expect(coordinator.staleCheckNeeded).toBe(true);
    });
  });

  describe('adoptRehydratedEntry', () => {
    it('wires in-memory state and registers with ordering service', async () => {
      const a = buildPersonality('Alice');
      const entry: RuntimeEntry = {
        groupId: 'rehydrated-group',
        sourceMessageId: 'msg-x',
        message: buildMessage(),
        channel: buildChannel(),
        guildId: 'guild-1',
        clientId: 'bot-1',
        userId: 'user-1',
        userMessageTime: new Date('2026-05-15T10:00:00Z'),
        userMessageContent: 'hi',
        slots: [
          {
            slotIndex: 0,
            personality: a,
            personaId: 'persona-a',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'fresh-job-Alice',
            status: 'pending',
          },
        ],
        createdAt: Date.now(),
        // Throwaway handle; the coordinator clears it. 0ms leaves no real timer pending.
        timeoutHandle: setTimeout(() => undefined, 0),
        truncated: false,
      };

      await coordinator.adoptRehydratedEntry(entry);

      expect(coordinator.ownsJob('fresh-job-Alice')).toBe(true);
      expect(orderingService.registerJob).toHaveBeenCalledWith(
        entry.channel.id,
        'rehydrated-group',
        entry.userMessageTime
      );
    });

    it('immediately flushes when every slot is already terminal at adopt time', async () => {
      // Shutdown happened mid-flush: all slots completed but Redis state
      // not yet cleared. On recovery, adopt should flush immediately.
      const a = buildPersonality('Alice');
      const entry: RuntimeEntry = {
        groupId: 'terminal-group',
        sourceMessageId: 'msg-y',
        message: buildMessage(),
        channel: buildChannel(),
        guildId: 'guild-1',
        clientId: 'bot-1',
        userId: 'user-1',
        userMessageTime: new Date('2026-05-15T10:00:00Z'),
        userMessageContent: 'hi',
        slots: [
          {
            slotIndex: 0,
            personality: a,
            personaId: 'persona-a',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-Alice',
            status: 'completed',
            result: { requestId: 'r1', success: true, content: 'pre-shutdown reply' },
          },
        ],
        createdAt: Date.now(),
        // Throwaway handle; the coordinator clears it. 0ms leaves no real timer pending.
        timeoutHandle: setTimeout(() => undefined, 0),
        truncated: false,
      };

      await coordinator.adoptRehydratedEntry(entry);

      // Group flushed immediately via deliverGroup → deliverSuccess called
      expect(slotDelivery.deliverSuccess).toHaveBeenCalledOnce();
    });
  });
});

/**
 * Wiring/seam test (per 02-code-standards rule 7): runs the REAL
 * coordinator → REAL SlotDeliveryService chain for the all-errored path,
 * mocking ONLY the external boundary (the webhook `responseSender` + the
 * history `persistence`). The per-dep-mocked unit tests above assert the
 * coordinator calls `deliverErrorNoPersist` with the right shape; this proves
 * that shape actually reaches the webhook per-persona, in-character, with no
 * fabricated history entry.
 */
describe('MultiTagCoordinator — all-errored in-character delivery (real chain)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(confirmDelivery).mockResolvedValue(undefined);
    vi.mocked(setDmSessionPersonality).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('each errored character reaches the webhook once, in-character, with no history persist and no double reply', async () => {
    const sendResponse = vi.fn().mockResolvedValue({ chunkMessageIds: ['c1'] });
    const saveAssistantMessage = vi.fn().mockResolvedValue(undefined);

    // REAL delivery service — only the webhook + persistence boundary is mocked.
    const realSlotDelivery = new SlotDeliveryService({
      responseSender: { sendResponse } as unknown as DiscordResponseSender,
      persistence: { saveAssistantMessage } as unknown as ConversationPersistence,
    });

    const chatManager = {
      // Every submission throws → every slot errors.
      submitChatJob: vi.fn().mockRejectedValue(new Error('gateway timeout')),
    };
    const coordinator = new MultiTagCoordinator({
      chatManager: chatManager as unknown as MultiTagCoordinatorDeps['chatManager'],
      jobTracker: {
        trackJob: vi.fn(),
        completeJob: vi.fn(),
      } as unknown as MultiTagCoordinatorDeps['jobTracker'],
      orderingService: {
        registerJob: vi.fn(),
        handleResult: vi.fn(),
      } as unknown as MultiTagCoordinatorDeps['orderingService'],
      slotDelivery: realSlotDelivery,
      persistence: {
        putEntry: vi.fn(),
      } as unknown as MultiTagCoordinatorDeps['persistence'],
      queue: {
        getJob: vi.fn().mockResolvedValue(null),
      } as unknown as MultiTagCoordinatorDeps['queue'],
    });

    const msg = buildMessage();
    await coordinator.startFanOut({
      message: msg,
      channel: buildChannel(),
      slots: [
        buildResolvedSlot(buildPersonality('Alice')),
        buildResolvedSlot(buildPersonality('Bob')),
      ],
      content: 'hi',
      truncated: false,
    });

    // Each errored character reached the webhook exactly once, in its own voice.
    expect(sendResponse).toHaveBeenCalledTimes(2);
    const sentPersonalityIds = sendResponse.mock.calls.map(c => c[0].personality.id);
    expect(sentPersonalityIds).toEqual(expect.arrayContaining(['id-Alice', 'id-Bob']));
    // No raw error leaked into the sent content.
    for (const [payload] of sendResponse.mock.calls) {
      expect(payload.content).not.toContain('gateway timeout');
    }
    // No fabricated conversation turn (submit failed before any turn existed).
    expect(saveAssistantMessage).not.toHaveBeenCalled();
    // No single bot-voice system notice.
    expect(vi.mocked(msg.reply)).not.toHaveBeenCalled();
  });
});
