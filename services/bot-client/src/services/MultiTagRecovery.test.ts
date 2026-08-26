/**
 * Tests for MultiTagRecovery — the startup hook that rehydrates in-flight
 * multi-tag fan-outs after a bot restart.
 *
 * Strategy: mock every external dep (persistence, coordinator, queue,
 * personalityService, Discord client). Drive the recovery lifecycle by
 * feeding in pre-built snapshots and asserting on the calls the recovery
 * service makes downstream.
 *
 * The core invariant under test: rebuildSlot polls BullMQ for the prior
 * job's authoritative state and dispatches accordingly — completed/failed
 * results from the prior process get delivered via handleJobResult AFTER
 * adoption, in-flight jobs are trusted to the live stream subscription,
 * and unrecoverable jobs (evicted from Redis) get a synthetic error
 * delivered.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Client, Message, Channel } from 'discord.js';
import type { Queue } from 'bullmq';
import { ChannelType } from 'discord.js';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { MultiTagRecovery, type MultiTagRecoveryDeps } from './MultiTagRecovery.js';
import type { CoordinatorEntrySnapshot, SlotSnapshot } from './MultiTagPersistence.js';
import { MULTI_TAG } from '@tzurot/common-types/constants/message';
import { confirmDelivery } from '../utils/gatewayServiceCalls.js';

// Only `confirmDelivery` is reached from this module; the rest of the gateway
// surface is deliberately absent so a new import would fail loudly here.
vi.mock('../utils/gatewayServiceCalls.js', () => ({
  confirmDelivery: vi.fn(),
}));

// Stable UUID for the test user's default persona; exercised in every resolution assertion.
const RESOLVED_PERSONA_ID = '00000000-0000-4000-8000-000000000aaa';

function buildPersonality(name: string): LoadedPersonality {
  return {
    id: `id-${name.toLowerCase()}`,
    slug: name.toLowerCase(),
    displayName: name,
    name,
  } as unknown as LoadedPersonality;
}

function buildSnapshot(
  overrides: Partial<CoordinatorEntrySnapshot> = {}
): CoordinatorEntrySnapshot {
  return {
    groupId: 'group-1',
    sourceMessageId: 'msg-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    userId: 'user-1',
    userMessageTime: '2026-05-15T10:00:00Z',
    userMessageContent: 'hi everyone',
    slots: [
      {
        slotIndex: 0,
        personalityId: 'id-alice',
        personalitySlug: 'alice',
        personaId: RESOLVED_PERSONA_ID,
        source: 'mention',
        isAutoResponse: false,
        jobId: 'old-job-Alice',
        status: 'pending',
      },
    ],
    // Fresh by default: these fixtures model a RECENTLY-interrupted fan-out
    // (the age gate discards entries older than the coordinator safety
    // window unless they carry a recovered result — tested in its own
    // describe with an explicitly ancient createdAt).
    createdAt: Date.now() - 60_000,
    truncated: false,
    maxTags: 5,
    ...overrides,
  };
}

/**
 * Builder for the mocked BullMQ Job returned by queue.getJob. State and
 * payload are parameterized; the mock surface is intentionally narrow —
 * production code only reads `getState()`, `returnvalue`, and
 * `failedReason`, so the test mock matches.
 */
function buildMockJob(opts: {
  state: string;
  returnvalue?: LLMGenerationResult;
  failedReason?: string;
}): {
  getState: ReturnType<typeof vi.fn>;
  returnvalue?: LLMGenerationResult;
  failedReason?: string;
} {
  return {
    getState: vi.fn().mockResolvedValue(opts.state),
    returnvalue: opts.returnvalue,
    failedReason: opts.failedReason,
  };
}

describe('MultiTagRecovery', () => {
  let persistence: {
    scanAllEntries: ReturnType<typeof vi.fn>;
    markStale: ReturnType<typeof vi.fn>;
    deleteEntry: ReturnType<typeof vi.fn>;
    updateEntry: ReturnType<typeof vi.fn>;
    isSlotDelivered: ReturnType<typeof vi.fn>;
  };
  let coordinator: {
    adoptRehydratedEntry: ReturnType<typeof vi.fn>;
    noteRecoveryMarkedStale: ReturnType<typeof vi.fn>;
    handleSafetyTimeoutPublic: ReturnType<typeof vi.fn>;
    handleJobResult: ReturnType<typeof vi.fn>;
  };
  let queue: {
    getJob: ReturnType<typeof vi.fn>;
  };
  let personalityService: {
    loadPersonality: ReturnType<typeof vi.fn>;
  };
  let discordClient: {
    channels: { fetch: ReturnType<typeof vi.fn> };
  };
  let mockChannel: {
    id: string;
    type: ChannelType;
    messages: { fetch: ReturnType<typeof vi.fn> };
  };
  let mockMessage: { id: string; client: { user: { id: string } } };
  let recovery: MultiTagRecovery;

  beforeEach(() => {
    persistence = {
      scanAllEntries: vi.fn().mockResolvedValue([]),
      markStale: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined),
      updateEntry: vi.fn().mockResolvedValue(undefined),
      isSlotDelivered: vi.fn().mockResolvedValue(false),
    };
    coordinator = {
      adoptRehydratedEntry: vi.fn().mockResolvedValue(undefined),
      noteRecoveryMarkedStale: vi.fn(),
      handleSafetyTimeoutPublic: vi.fn().mockResolvedValue(undefined),
      handleJobResult: vi.fn().mockResolvedValue(undefined),
    };
    // Default: every job returns 'active' state — the "trust the stream"
    // path. Individual tests override per-jobId via mockImplementation.
    queue = {
      getJob: vi.fn().mockImplementation(async () => buildMockJob({ state: 'active' })),
    };
    personalityService = {
      // Recovery looks up by ID first (stable), falls back to slug (mutable).
      // Snapshots in this test use `personalityId: 'id-alice'` and
      // `personalitySlug: 'alice'` — strip the `id-` prefix so both lookup
      // shapes map to the same logical personality.
      loadPersonality: vi.fn().mockImplementation(async (nameOrId: string) => {
        const slug = nameOrId.startsWith('id-') ? nameOrId.slice(3) : nameOrId;
        return buildPersonality(slug);
      }),
    };
    mockMessage = { id: 'msg-1', client: { user: { id: 'bot-1' } } };
    mockChannel = {
      id: 'channel-1',
      type: ChannelType.DM,
      messages: {
        fetch: vi.fn().mockResolvedValue(mockMessage as unknown as Message),
      },
    };
    discordClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue(mockChannel as unknown as Channel),
      },
    };
    vi.mocked(confirmDelivery).mockReset();
    vi.mocked(confirmDelivery).mockResolvedValue(undefined);

    recovery = new MultiTagRecovery({
      persistence: persistence as unknown as MultiTagRecoveryDeps['persistence'],
      coordinator: coordinator as unknown as MultiTagRecoveryDeps['coordinator'],
      personalityService:
        personalityService as unknown as MultiTagRecoveryDeps['personalityService'],
      discordClient: discordClient as unknown as Client,
      queue: queue as unknown as Queue,
    });
  });

  describe('completed-job recovery (synthetic delivery)', () => {
    it("polls BullMQ, finds 'completed' state, and delivers job.returnvalue via handleJobResult", async () => {
      const priorResult: LLMGenerationResult = {
        requestId: 'old-job-Alice',
        success: true,
        content: 'response from the prior process',
      };
      queue.getJob.mockResolvedValue(
        buildMockJob({ state: 'completed', returnvalue: priorResult })
      );
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.entriesScanned).toBe(1);
      expect(stats.entriesResumed).toBe(1);
      expect(stats.slotsRecoveredCompleted).toBe(1);
      expect(stats.slotsTrustedToStream).toBe(0);
      // Entry adopted; THEN handleJobResult invoked with prior process's result.
      expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
      expect(coordinator.handleJobResult).toHaveBeenCalledOnce();
      expect(coordinator.handleJobResult).toHaveBeenCalledWith('old-job-Alice', priorResult);
      // No stale marking on the recovered slot — its jobId is still the live
      // tracking ID, and the prior result is what we're consuming.
      expect(persistence.markStale).not.toHaveBeenCalled();
    });

    it('preserves call ordering: adoptRehydratedEntry runs strictly before handleJobResult', async () => {
      // The coordinator's jobToGroup map is populated by adoption; calling
      // handleJobResult first would silently drop the result (warn + return).
      // This ordering is load-bearing.
      const callOrder: string[] = [];
      coordinator.adoptRehydratedEntry.mockImplementation(async () => {
        callOrder.push('adopt');
      });
      coordinator.handleJobResult.mockImplementation(async () => {
        callOrder.push('handleJobResult');
      });
      queue.getJob.mockResolvedValue(
        buildMockJob({
          state: 'completed',
          returnvalue: { requestId: 'old-job-Alice', success: true, content: 'hi' },
        })
      );
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      await recovery.run();

      expect(callOrder).toEqual(['adopt', 'handleJobResult']);
    });
  });

  describe('failed-job recovery (synthetic error delivery)', () => {
    it("polls BullMQ, finds 'failed' state, and synthesizes an error LLMGenerationResult", async () => {
      queue.getJob.mockResolvedValue(
        buildMockJob({ state: 'failed', failedReason: 'OpenRouter 502 Bad Gateway' })
      );
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsRecoveredFailed).toBe(1);
      expect(coordinator.handleJobResult).toHaveBeenCalledWith(
        'old-job-Alice',
        expect.objectContaining({
          requestId: 'old-job-Alice',
          success: false,
          error: 'OpenRouter 502 Bad Gateway',
        })
      );
    });

    it("falls back to 'Unknown failure' when job has no failedReason", async () => {
      queue.getJob.mockResolvedValue(buildMockJob({ state: 'failed' }));
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      await recovery.run();

      expect(coordinator.handleJobResult).toHaveBeenCalledWith(
        'old-job-Alice',
        expect.objectContaining({ success: false, error: 'Unknown failure' })
      );
    });
  });

  describe('in-flight job recovery (trust the stream)', () => {
    it.each(['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'])(
      "leaves slot pending with old jobId when state is '%s'",
      async (state: string) => {
        queue.getJob.mockResolvedValue(buildMockJob({ state }));
        persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

        const stats = await recovery.run();

        expect(stats.slotsTrustedToStream).toBe(1);
        expect(stats.slotsRecoveredCompleted).toBe(0);
        expect(stats.slotsRecoveredFailed).toBe(0);
        expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
        // No deferred delivery; the live stream + QueueEvents will deliver
        // once they attach.
        expect(coordinator.handleJobResult).not.toHaveBeenCalled();
        // Slot keeps its original jobId — not marked stale, not resubmitted.
        expect(persistence.markStale).not.toHaveBeenCalled();
      }
    );
  });

  describe('re-armed safety timer (original deadline, not a fresh window)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("fires at the entry's ORIGINAL deadline — a restart must not extend a wedged group's hold", async () => {
      // Entry is 10 minutes old at boot → 8 minutes of budget remain.
      queue.getJob.mockResolvedValue(buildMockJob({ state: 'active' }));
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({ createdAt: Date.now() - 10 * 60 * 1000 }),
      ]);

      await recovery.run();

      const remainingMs = MULTI_TAG.COORDINATOR_TIMEOUT_MS - 10 * 60 * 1000;
      await vi.advanceTimersByTimeAsync(remainingMs - 1000);
      expect(coordinator.handleSafetyTimeoutPublic).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2000);
      expect(coordinator.handleSafetyTimeoutPublic).toHaveBeenCalledWith('group-1');
    });

    it('floors the re-armed timer so adoption and deferred deliveries get room to run', async () => {
      // Entry adopted with almost no budget left (age-gate still passes).
      queue.getJob.mockResolvedValue(buildMockJob({ state: 'active' }));
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({ createdAt: Date.now() - (MULTI_TAG.COORDINATOR_TIMEOUT_MS - 5000) }),
      ]);

      await recovery.run();

      // 5s of nominal budget remain, but the floor holds the timer at 60s.
      await vi.advanceTimersByTimeAsync(50_000);
      expect(coordinator.handleSafetyTimeoutPublic).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(15_000);
      expect(coordinator.handleSafetyTimeoutPublic).toHaveBeenCalledWith('group-1');
    });
  });

  describe('age gate (zombie-group class: entries older than the safety window)', () => {
    const ANCIENT = (): number => Date.now() - (MULTI_TAG.COORDINATOR_TIMEOUT_MS + 60_000); // window + 1 min

    it('discards an ancient entry whose slot is still pending-class — no adoption, no delivery, no synthetic error', async () => {
      queue.getJob.mockResolvedValue(buildMockJob({ state: 'waiting-children' }));
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot({ createdAt: ANCIENT() })]);

      const stats = await recovery.run();

      expect(stats.entriesExpiredSilent).toBe(1);
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();
    });

    it('discards an ancient entry whose only outcome is a synthesized failure (evicted job) — late errors alone are noise', async () => {
      queue.getJob.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot({ createdAt: ANCIENT() })]);

      const stats = await recovery.run();

      expect(stats.entriesExpiredSilent).toBe(1);
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();
    });

    it('discards an ancient entry whose only outcome is a REAL recovered failure — a late error is noise whether real or synthetic', async () => {
      queue.getJob.mockResolvedValue(
        buildMockJob({ state: 'failed', failedReason: 'content policy rejection' })
      );
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot({ createdAt: ANCIENT() })]);

      const stats = await recovery.run();

      expect(stats.entriesExpiredSilent).toBe(1);
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();
    });

    it('ADOPTS an ancient entry that recovered a real completed result — late-but-real still delivers', async () => {
      queue.getJob.mockResolvedValue(
        buildMockJob({
          state: 'completed',
          returnvalue: {
            requestId: 'old-job-Alice',
            success: true,
            content: 'late but real',
          } as LLMGenerationResult,
        })
      );
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot({ createdAt: ANCIENT() })]);

      const stats = await recovery.run();

      expect(stats.entriesExpiredSilent).toBe(0);
      expect(stats.slotsRecoveredCompleted).toBe(1);
      expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
      expect(coordinator.handleJobResult).toHaveBeenCalledOnce();
    });

    it('an already-delivered completed slot does not keep an ancient entry alive for its still-pending sibling', async () => {
      // Mixed ancient entry: Alice polled 'completed' AND carries the
      // slot-delivered marker (the user already has her reply); Bob is
      // genuinely in flight with no marker. The age gate's "real result"
      // exception is evaluated against the SURVIVING deliveries, so Alice —
      // already served — cannot vouch for Bob. Bob is the wedged-slot shape
      // the gate exists for: if the old instance were alive it would have
      // safety-flushed this group long ago.
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({
            state: 'completed',
            returnvalue: {
              requestId: 'old-job-Alice',
              success: true,
              content: 'already sent',
            } as LLMGenerationResult,
          });
        }
        return buildMockJob({ state: 'waiting-children' });
      });
      persistence.isSlotDelivered.mockImplementation(
        async (jobId: string) => jobId === 'old-job-Alice'
      );
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({
          createdAt: ANCIENT(),
          slots: [
            {
              slotIndex: 0,
              personalityId: 'id-alice',
              personalitySlug: 'alice',
              personaId: RESOLVED_PERSONA_ID,
              source: 'mention',
              isAutoResponse: false,
              jobId: 'old-job-Alice',
              status: 'pending',
            },
            {
              slotIndex: 1,
              personalityId: 'id-bob',
              personalitySlug: 'bob',
              personaId: RESOLVED_PERSONA_ID,
              source: 'mention',
              isAutoResponse: false,
              jobId: 'old-job-Bob',
              status: 'pending',
            },
          ],
        }),
      ]);

      const stats = await recovery.run();

      expect(stats.entriesExpiredSilent).toBe(1);
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();
      // Bob's jobId is marked stale so a late arrival for the discarded entry
      // is dropped rather than delivered against nothing.
      expect(persistence.markStale).toHaveBeenCalledWith('old-job-Alice', 'old-job-Bob');
    });

    it('a YOUNG entry with a pending slot adopts as before (regression guard)', async () => {
      queue.getJob.mockResolvedValue(buildMockJob({ state: 'active' }));
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({ createdAt: Date.now() - 30_000 }),
      ]);

      const stats = await recovery.run();

      expect(stats.entriesExpiredSilent).toBe(0);
      expect(stats.slotsTrustedToStream).toBe(1);
      expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
    });
  });

  describe('unrecoverable job (evicted from Redis or unknown state)', () => {
    it('delivers synthetic "Result unavailable after restart" when getJob returns null', async () => {
      queue.getJob.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsUnrecoverable).toBe(1);
      expect(coordinator.handleJobResult).toHaveBeenCalledWith(
        'old-job-Alice',
        expect.objectContaining({
          success: false,
          error: 'Result unavailable after restart',
        })
      );
    });

    it("treats 'completed' with undefined returnvalue as unrecoverable (worker-crash or GC-race guard)", async () => {
      // Architectural guarantee: ai-worker handlers return LLMGenerationResult.
      // Edge cases that break that guarantee at runtime: worker crash after
      // moveToCompleted but before returnvalue persist, or removeOnComplete
      // GC racing the state→returnvalue read window. Routing through the
      // unrecoverable path keeps the user-visible error message correct
      // ("Result unavailable") instead of letting a malformed result reach
      // coordinator.handleJobResult.
      queue.getJob.mockResolvedValue(buildMockJob({ state: 'completed', returnvalue: undefined }));
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsUnrecoverable).toBe(1);
      expect(stats.slotsRecoveredCompleted).toBe(0);
      expect(coordinator.handleJobResult).toHaveBeenCalledWith(
        'old-job-Alice',
        expect.objectContaining({
          success: false,
          error: 'Result unavailable after restart',
        })
      );
    });

    it("delivers synthetic error when state is 'unknown' (or any future BullMQ state)", async () => {
      queue.getJob.mockResolvedValue(buildMockJob({ state: 'unknown' }));
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsUnrecoverable).toBe(1);
      expect(coordinator.handleJobResult).toHaveBeenCalledWith(
        'old-job-Alice',
        expect.objectContaining({ success: false })
      );
    });
  });

  describe('error tolerance during state polling', () => {
    it("falls back to 'inFlight' (no delivery, trust stream) when queue.getJob throws", async () => {
      queue.getJob.mockRejectedValue(new Error('Redis blip'));
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsTrustedToStream).toBe(1);
      expect(stats.slotsUnrecoverable).toBe(0);
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();
      // Slot still adopted — recovery continues normally.
      expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
    });

    it("falls back to 'inFlight' when job.getState throws", async () => {
      queue.getJob.mockResolvedValue({
        getState: vi.fn().mockRejectedValue(new Error('Connection lost')),
        returnvalue: undefined,
        failedReason: undefined,
      });
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsTrustedToStream).toBe(1);
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();
    });
  });

  describe('mixed entries', () => {
    it('routes each slot independently when an entry has slots in different BullMQ states', async () => {
      const completedResult: LLMGenerationResult = {
        requestId: 'old-job-Alice',
        success: true,
        content: 'Alice completed during the gap',
      };
      // Slot A completed; slot B still active.
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({ state: 'completed', returnvalue: completedResult });
        }
        if (jobId === 'old-job-Bob') {
          return buildMockJob({ state: 'active' });
        }
        return null;
      });
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'pending',
          },
          {
            slotIndex: 1,
            personalityId: 'id-bob',
            personalitySlug: 'bob',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Bob',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      const stats = await recovery.run();

      expect(stats.slotsRecoveredCompleted).toBe(1);
      expect(stats.slotsTrustedToStream).toBe(1);
      // Only Alice's completed result delivers; Bob waits for the stream.
      expect(coordinator.handleJobResult).toHaveBeenCalledOnce();
      expect(coordinator.handleJobResult).toHaveBeenCalledWith('old-job-Alice', completedResult);
    });

    it('continues delivering remaining slots when one handleJobResult throws mid-loop', async () => {
      // Per-delivery try/catch: a throw from one handleJobResult must not
      // skip subsequent deliveries. The outer recoverOne catch is too
      // coarse — it would log "Recovery failed for entry" and abandon the
      // remaining work even if other slots have already-completed results
      // sitting on BullMQ ready to deliver.
      const aliceResult: LLMGenerationResult = {
        requestId: 'old-job-Alice',
        success: true,
        content: 'alice content',
      };
      const bobResult: LLMGenerationResult = {
        requestId: 'old-job-Bob',
        success: true,
        content: 'bob content',
      };
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({ state: 'completed', returnvalue: aliceResult });
        }
        if (jobId === 'old-job-Bob') {
          return buildMockJob({ state: 'completed', returnvalue: bobResult });
        }
        return null;
      });
      // First delivery (Alice) throws; second delivery (Bob) must still proceed.
      coordinator.handleJobResult
        .mockRejectedValueOnce(new Error('handleJobResult failed for Alice'))
        .mockResolvedValueOnce(undefined);
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'pending',
          },
          {
            slotIndex: 1,
            personalityId: 'id-bob',
            personalitySlug: 'bob',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Bob',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      await recovery.run();

      // Both deliveries attempted despite the first throwing.
      expect(coordinator.handleJobResult).toHaveBeenCalledTimes(2);
      expect(coordinator.handleJobResult).toHaveBeenNthCalledWith(1, 'old-job-Alice', aliceResult);
      expect(coordinator.handleJobResult).toHaveBeenNthCalledWith(2, 'old-job-Bob', bobResult);
    });
  });

  describe('idempotent re-dispatch (slot-delivered marker)', () => {
    it('skips dispatch when a prior run already delivered the slot', async () => {
      // Scenario: previous bot lifecycle delivered the message to Discord
      // but crashed before deliverGroup's deleteEntry call ran. The entry
      // snapshot still shows the flush-trigger slot as pending, BullMQ
      // shows the job as completed. Without the marker check, recovery
      // would re-dispatch → second user-visible delivery.
      const aliceResult: LLMGenerationResult = {
        requestId: 'old-job-Alice',
        success: true,
        content: 'alice content (already delivered)',
      };
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({ state: 'completed', returnvalue: aliceResult });
        }
        return null;
      });
      persistence.isSlotDelivered.mockImplementation(
        async (jobId: string) => jobId === 'old-job-Alice'
      );
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      const stats = await recovery.run();

      expect(persistence.isSlotDelivered).toHaveBeenCalledWith('old-job-Alice');
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();
      expect(stats.slotsAlreadyDelivered).toBe(1);
    });

    it('dispatches normally when the marker is absent', async () => {
      const aliceResult: LLMGenerationResult = {
        requestId: 'old-job-Alice',
        success: true,
        content: 'alice content',
      };
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({ state: 'completed', returnvalue: aliceResult });
        }
        return null;
      });
      // Default isSlotDelivered returns false — exercised here explicitly.
      persistence.isSlotDelivered.mockResolvedValue(false);
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      const stats = await recovery.run();

      expect(coordinator.handleJobResult).toHaveBeenCalledWith('old-job-Alice', aliceResult);
      expect(stats.slotsAlreadyDelivered).toBe(0);
    });

    it('skips per-slot based on marker presence in mixed entries', async () => {
      // Slot A: previously delivered (marker present). Slot B: not delivered.
      // Only Slot B's dispatch should fire.
      const aliceResult: LLMGenerationResult = {
        requestId: 'old-job-Alice',
        success: true,
        content: 'alice (delivered)',
      };
      const bobResult: LLMGenerationResult = {
        requestId: 'old-job-Bob',
        success: true,
        content: 'bob (not delivered)',
      };
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({ state: 'completed', returnvalue: aliceResult });
        }
        if (jobId === 'old-job-Bob') {
          return buildMockJob({ state: 'completed', returnvalue: bobResult });
        }
        return null;
      });
      persistence.isSlotDelivered.mockImplementation(
        async (jobId: string) => jobId === 'old-job-Alice'
      );
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'pending',
          },
          {
            slotIndex: 1,
            personalityId: 'id-bob',
            personalitySlug: 'bob',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Bob',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      const stats = await recovery.run();

      expect(coordinator.handleJobResult).toHaveBeenCalledOnce();
      expect(coordinator.handleJobResult).toHaveBeenCalledWith('old-job-Bob', bobResult);
      expect(stats.slotsAlreadyDelivered).toBe(1);
    });

    it('counts an already-delivered slot only once, under slotsAlreadyDelivered', async () => {
      // Disjointness of the aggregate RecoveryStats: both slots poll
      // 'completed', but Alice carries the delivered marker. Alice must NOT
      // also appear in slotsRecoveredCompleted — otherwise the top-level
      // recovery-health numbers overstate dispatches and stop reconciling
      // against the sum of the per-entry 'Multi-tag entry rehydrated' logs,
      // which are computed from the post-marker-pass survivors.
      queue.getJob.mockImplementation(async (jobId: string) =>
        buildMockJob({
          state: 'completed',
          returnvalue: { requestId: jobId, success: true, content: 'content' },
        })
      );
      persistence.isSlotDelivered.mockImplementation(
        async (jobId: string) => jobId === 'old-job-Alice'
      );
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({
          slots: [
            {
              slotIndex: 0,
              personalityId: 'id-alice',
              personalitySlug: 'alice',
              personaId: RESOLVED_PERSONA_ID,
              source: 'mention',
              isAutoResponse: false,
              jobId: 'old-job-Alice',
              status: 'pending',
            },
            {
              slotIndex: 1,
              personalityId: 'id-bob',
              personalitySlug: 'bob',
              personaId: RESOLVED_PERSONA_ID,
              source: 'mention',
              isAutoResponse: false,
              jobId: 'old-job-Bob',
              status: 'pending',
            },
          ],
        }),
      ]);

      const stats = await recovery.run();

      expect(stats.slotsAlreadyDelivered).toBe(1);
      // Bob alone — Alice's completed poll is absorbed by the marker.
      expect(stats.slotsRecoveredCompleted).toBe(1);
      // The whole per-slot family sums to the two slots, no slot twice.
      expect(
        stats.slotsAlreadyDelivered +
          stats.slotsRecoveredCompleted +
          stats.slotsRecoveredFailed +
          stats.slotsUnrecoverable +
          stats.slotsTrustedToStream
      ).toBe(2);
    });
  });

  describe('already-delivered slots never reach the safety timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * The prod shape: a group fully delivered seconds before a deploy restart,
     * its Redis entry outliving the shutdown. Recovery correctly identified the
     * slot as delivered but still rehydrated it as pending and armed the safety
     * timer, which ~17 minutes later synthesized an in-character timeout for a
     * user who already had the real reply.
     */
    it('cleans up an entry whose only slot is already delivered — no adoption, no timer, no flush', async () => {
      queue.getJob.mockResolvedValue(
        buildMockJob({
          state: 'completed',
          returnvalue: { requestId: 'old-job-Alice', success: true, content: 'already sent' },
        })
      );
      persistence.isSlotDelivered.mockResolvedValue(true);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsAlreadyDelivered).toBe(1);
      expect(stats.entriesResumed).toBe(0);
      expect(stats.entriesDiscarded).toBe(1);
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();
      expect(persistence.deleteEntry).toHaveBeenCalledOnce();

      // Past the full coordinator budget: nothing may fire.
      await vi.advanceTimersByTimeAsync(MULTI_TAG.COORDINATOR_TIMEOUT_MS * 2);
      expect(coordinator.handleSafetyTimeoutPublic).not.toHaveBeenCalled();
    });

    /**
     * The same bug reached through the poll's ERROR path. `pollPriorJobState`
     * reports `inFlight` when `queue.getJob` or `job.getState` throws, so a job
     * that actually completed and was actually delivered looks in-flight
     * whenever the poll hits a Redis error — and recovery runs at boot, right
     * after the Redis connection is re-established. The marker lookup is what
     * separates the two, so it must run for a pending slot as well.
     */
    it('cleans up a delivered slot whose state poll THREW — the poll error must not skip the marker lookup', async () => {
      queue.getJob.mockRejectedValue(new Error('Redis blip'));
      persistence.isSlotDelivered.mockResolvedValue(true);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsAlreadyDelivered).toBe(1);
      // Not also counted as trusted-to-stream: the five per-slot counters are
      // disjoint, and this slot's marker resolved true.
      expect(stats.slotsTrustedToStream).toBe(0);
      expect(stats.entriesResumed).toBe(0);
      expect(stats.entriesDiscarded).toBe(1);
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();

      // Past the full coordinator budget: no synthetic timeout for a slot the
      // user already received.
      await vi.advanceTimersByTimeAsync(MULTI_TAG.COORDINATOR_TIMEOUT_MS * 2);
      expect(coordinator.handleSafetyTimeoutPublic).not.toHaveBeenCalled();
    });

    it('leaves a delivered failed-poll slot terminal inside a mixed entry, timer-covering only its live sibling', async () => {
      // Alice: getState throws (error-path inFlight) AND carries a marker.
      // Bob: genuinely active, no marker — the timer must still cover him.
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return {
            getState: vi.fn().mockRejectedValue(new Error('Connection lost')),
            returnvalue: undefined,
            failedReason: undefined,
          };
        }
        return buildMockJob({ state: 'active' });
      });
      persistence.isSlotDelivered.mockImplementation(
        async (jobId: string) => jobId === 'old-job-Alice'
      );
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({
          slots: [
            {
              slotIndex: 0,
              personalityId: 'id-alice',
              personalitySlug: 'alice',
              personaId: RESOLVED_PERSONA_ID,
              source: 'mention',
              isAutoResponse: false,
              jobId: 'old-job-Alice',
              status: 'pending',
            },
            {
              slotIndex: 1,
              personalityId: 'id-bob',
              personalitySlug: 'bob',
              personaId: RESOLVED_PERSONA_ID,
              source: 'mention',
              isAutoResponse: false,
              jobId: 'old-job-Bob',
              status: 'pending',
            },
          ],
        }),
      ]);

      const stats = await recovery.run();

      expect(stats.entriesResumed).toBe(1);
      expect(stats.slotsAlreadyDelivered).toBe(1);
      // Bob alone — Alice's marker took her out of the trusted-to-stream bucket.
      expect(stats.slotsTrustedToStream).toBe(1);

      const adopted = coordinator.adoptRehydratedEntry.mock.calls[0][0] as {
        slots: { jobId: string; status: string; alreadyDelivered?: boolean }[];
      };
      const alice = adopted.slots.find(s => s.jobId === 'old-job-Alice');
      const bob = adopted.slots.find(s => s.jobId === 'old-job-Bob');
      expect(alice?.status).toBe('completed');
      expect(alice?.alreadyDelivered).toBe(true);
      expect(bob?.status).toBe('pending');
      expect(bob?.alreadyDelivered).toBeUndefined();

      await vi.advanceTimersByTimeAsync(MULTI_TAG.COORDINATOR_TIMEOUT_MS);
      expect(coordinator.handleSafetyTimeoutPublic).toHaveBeenCalledWith('group-1');
    });

    it('adopts a mixed entry with the delivered slot already terminal and the pending one still timer-covered', async () => {
      const bobResult: LLMGenerationResult = {
        requestId: 'old-job-Bob',
        success: true,
        content: 'bob still owes a reply',
      };
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({
            state: 'completed',
            returnvalue: { requestId: 'old-job-Alice', success: true, content: 'already sent' },
          });
        }
        return buildMockJob({ state: 'active', returnvalue: bobResult });
      });
      persistence.isSlotDelivered.mockImplementation(
        async (jobId: string) => jobId === 'old-job-Alice'
      );
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({
          slots: [
            {
              slotIndex: 0,
              personalityId: 'id-alice',
              personalitySlug: 'alice',
              personaId: RESOLVED_PERSONA_ID,
              source: 'mention',
              isAutoResponse: false,
              jobId: 'old-job-Alice',
              status: 'pending',
            },
            {
              slotIndex: 1,
              personalityId: 'id-bob',
              personalitySlug: 'bob',
              personaId: RESOLVED_PERSONA_ID,
              source: 'mention',
              isAutoResponse: false,
              jobId: 'old-job-Bob',
              status: 'pending',
            },
          ],
        }),
      ]);

      const stats = await recovery.run();

      expect(stats.entriesResumed).toBe(1);
      expect(stats.slotsAlreadyDelivered).toBe(1);
      expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
      // No re-dispatch for the delivered slot; the pending one is left to the stream.
      expect(coordinator.handleJobResult).not.toHaveBeenCalled();

      const adopted = coordinator.adoptRehydratedEntry.mock.calls[0][0] as {
        slots: { jobId: string; status: string; alreadyDelivered?: boolean }[];
      };
      const alice = adopted.slots.find(s => s.jobId === 'old-job-Alice');
      const bob = adopted.slots.find(s => s.jobId === 'old-job-Bob');
      expect(alice?.status).toBe('completed');
      expect(alice?.alreadyDelivered).toBe(true);
      expect(bob?.status).toBe('pending');
      expect(bob?.alreadyDelivered).toBeUndefined();

      // The timer still exists — it covers Bob, who can still produce output.
      await vi.advanceTimersByTimeAsync(MULTI_TAG.COORDINATOR_TIMEOUT_MS);
      expect(coordinator.handleSafetyTimeoutPublic).toHaveBeenCalledWith('group-1');
    });
  });

  /**
   * A discarded entry never reaches `deliverGroup`, whose confirm fan-out is
   * what flips a slot's gateway `job_results` row from PENDING_DELIVERY to
   * DELIVERED. Since the ai-worker cleanup job only deletes DELIVERED rows,
   * an unconfirmed row for a slot the prior run actually sent is never
   * reclaimed — so every discard path confirms its already-delivered slots,
   * and only those.
   */
  describe('delivery confirmation on discard paths', () => {
    /**
     * Two slots so "confirms each delivered jobId" is distinguishable from
     * "confirms one of them", and so a per-jobId marker mock can make the two
     * slots differ — a single-slot fixture cannot separate "confirms the
     * delivered slot" from "confirms every slot".
     */
    function aliceAndBobSlots(): SlotSnapshot[] {
      return [
        {
          slotIndex: 0,
          personalityId: 'id-alice',
          personalitySlug: 'alice',
          personaId: RESOLVED_PERSONA_ID,
          source: 'mention',
          isAutoResponse: false,
          jobId: 'old-job-Alice',
          status: 'pending',
        },
        {
          slotIndex: 1,
          personalityId: 'id-bob',
          personalitySlug: 'bob',
          personaId: RESOLVED_PERSONA_ID,
          source: 'mention',
          isAutoResponse: false,
          jobId: 'old-job-Bob',
          status: 'pending',
        },
      ];
    }

    it('confirms delivery for EVERY slot when the whole entry was already delivered', async () => {
      queue.getJob.mockImplementation(async (jobId: string) =>
        buildMockJob({
          state: 'completed',
          returnvalue: { requestId: jobId, success: true, content: 'already sent' },
        })
      );
      persistence.isSlotDelivered.mockResolvedValue(true);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot({ slots: aliceAndBobSlots() })]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(stats.slotsAlreadyDelivered).toBe(2);
      expect(vi.mocked(confirmDelivery)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('old-job-Alice');
      expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('old-job-Bob');
    });

    it('does NOT confirm a slot the prior run never delivered (age-gate discard of a mixed entry)', async () => {
      // Ancient entry: Alice completed AND marked delivered; Bob genuinely
      // wedged with no marker. The gate discards, and Bob — never sent to
      // Discord — must not be flipped to DELIVERED.
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({
            state: 'completed',
            returnvalue: { requestId: 'old-job-Alice', success: true, content: 'already sent' },
          });
        }
        return buildMockJob({ state: 'waiting-children' });
      });
      persistence.isSlotDelivered.mockImplementation(
        async (jobId: string) => jobId === 'old-job-Alice'
      );
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({
          createdAt: Date.now() - (MULTI_TAG.COORDINATOR_TIMEOUT_MS + 60_000),
          slots: aliceAndBobSlots(),
        }),
      ]);

      const stats = await recovery.run();

      expect(stats.entriesExpiredSilent).toBe(1);
      expect(vi.mocked(confirmDelivery)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('old-job-Alice');
      expect(vi.mocked(confirmDelivery)).not.toHaveBeenCalledWith('old-job-Bob');
    });

    it('confirms the delivered slot when a mixed entry is discarded for an unreachable channel', async () => {
      discordClient.channels.fetch.mockResolvedValue(null);
      queue.getJob.mockImplementation(async (jobId: string) => {
        if (jobId === 'old-job-Alice') {
          return buildMockJob({
            state: 'completed',
            returnvalue: { requestId: 'old-job-Alice', success: true, content: 'already sent' },
          });
        }
        return buildMockJob({ state: 'active' });
      });
      persistence.isSlotDelivered.mockImplementation(
        async (jobId: string) => jobId === 'old-job-Alice'
      );
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot({ slots: aliceAndBobSlots() })]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(vi.mocked(confirmDelivery)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('old-job-Alice');
    });

    it('confirms nothing when a discarded entry carries no delivered slot', async () => {
      discordClient.channels.fetch.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot({ slots: aliceAndBobSlots() })]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(vi.mocked(confirmDelivery)).not.toHaveBeenCalled();
    });

    it('skips the confirm for a timed-out slot, mirroring deliverGroup', async () => {
      // ai-worker never wrote a JobResult row for a synthesized timeout, so
      // confirming it is a guaranteed 404 — deliverGroup filters the same shape
      // out of its own fan-out.
      persistence.isSlotDelivered.mockResolvedValue(true);
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({
          slots: [{ ...aliceAndBobSlots()[0], status: 'timedout' }],
        }),
      ]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(stats.slotsAlreadyDelivered).toBe(1);
      expect(vi.mocked(confirmDelivery)).not.toHaveBeenCalled();
    });
  });

  describe('discard cases', () => {
    it('discards an entry when the channel can no longer be fetched', async () => {
      discordClient.channels.fetch.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(stats.entriesResumed).toBe(0);
      // Pending jobIds still marked stale on discard — late deliveries
      // wouldn't have an entry to route to and should be silently dropped.
      expect(persistence.markStale).toHaveBeenCalledWith('old-job-Alice');
      expect(persistence.deleteEntry).toHaveBeenCalledOnce();
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
      // State polls DO run before the channel check now: BullMQ polls are
      // cheap local Redis reads, while Discord fetches are rate-limited —
      // the age-gate reorder deliberately front-loads the cheap step so
      // zombie entries never pay the Discord round-trips.
      expect(queue.getJob).toHaveBeenCalled();
    });

    it('discards an entry when the source message is gone', async () => {
      mockChannel.messages.fetch.mockRejectedValue(new Error('Unknown Message'));
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(persistence.deleteEntry).toHaveBeenCalledOnce();
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
    });

    it('discards when channel type is not a TypingChannel', async () => {
      // Voice channels don't support sendTyping — not a TypingChannel.
      const voiceChannel = {
        id: 'voice-1',
        type: ChannelType.GuildVoice,
      };
      discordClient.channels.fetch.mockResolvedValue(voiceChannel as unknown as Channel);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
    });
  });

  describe('access-revoked slots', () => {
    it('marks a slot errored when its personality is no longer accessible', async () => {
      // Recovery tries ID first, falls back to slug. Both must return null
      // for the slot to be treated as revoked.
      personalityService.loadPersonality.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.slotsAccessRevoked).toBe(1);
      // No state poll — when the personality is gone we can't render the
      // result anyway, so the slot becomes a synthetic-error slot regardless
      // of the prior job's state.
      expect(queue.getJob).not.toHaveBeenCalled();
      // Entry STILL adopted (errored slot is delivered as an error message)
      expect(coordinator.adoptRehydratedEntry).toHaveBeenCalledOnce();
      expect(stats.entriesResumed).toBe(1);
    });

    it('falls back to slug lookup when ID lookup returns null (slug rename)', async () => {
      // Scenario: ID-form lookup fails (loader doesn't recognize the UUID
      // for some reason), slug-form succeeds. Slot recovers normally.
      personalityService.loadPersonality.mockImplementation(
        async (nameOrId: string): Promise<LoadedPersonality | null> => {
          if (nameOrId.startsWith('id-')) return null;
          return buildPersonality(nameOrId);
        }
      );
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      await recovery.run();

      expect(personalityService.loadPersonality).toHaveBeenCalledWith('id-alice', 'user-1');
      expect(personalityService.loadPersonality).toHaveBeenCalledWith('alice', 'user-1');
      // State poll runs because the slug fallback rescued the personality.
      expect(queue.getJob).toHaveBeenCalledWith('old-job-Alice');
    });
  });

  describe('personaId resolution from the snapshot', () => {
    function legacyAliceSlot(): SlotSnapshot {
      // A slot WITHOUT personaId — the shape a snapshot had before the field
      // was added (in-flight at that deploy).
      return {
        slotIndex: 0,
        personalityId: 'id-alice',
        personalitySlug: 'alice',
        source: 'mention',
        isAutoResponse: false,
        jobId: 'old-job-Alice',
        status: 'pending',
      };
    }

    it('attaches the snapshot personaId to the recovered slot (no re-resolution)', async () => {
      // The persona was resolved at fan-out time and captured in the snapshot.
      // Recovery reads it verbatim — a real `personas.id` FK means
      // `saveAssistantMessage` succeeds and the recovered message persists.
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      await recovery.run();

      const adoptedEntry = coordinator.adoptRehydratedEntry.mock.calls[0]?.[0] as {
        slots: Array<{ personaId: string }>;
      };
      expect(adoptedEntry.slots[0]?.personaId).toBe(RESOLVED_PERSONA_ID);
    });

    it('falls back to a synthetic personaId when the snapshot persona is the system default (empty)', async () => {
      // Empty personaId = system-default summon (no real persona). The slot
      // still adopts and delivers — the synthetic `recovery-fallback-*` is
      // caught by the saveAssistantMessage try/catch, so the user gets their
      // message; history just doesn't persist for this edge case.
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({ slots: [{ ...legacyAliceSlot(), personaId: '' }] }),
      ]);

      const stats = await recovery.run();

      expect(stats.entriesResumed).toBe(1);
      const adoptedEntry = coordinator.adoptRehydratedEntry.mock.calls[0]?.[0] as {
        slots: Array<{ personaId: string }>;
      };
      expect(adoptedEntry.slots[0]?.personaId).toBe('recovery-fallback-alice');
    });

    it('falls back to a synthetic personaId for a legacy snapshot missing the field', async () => {
      // Recovery must not re-resolve (would need Prisma), so a legacy snapshot
      // with no personaId gets the synthetic fallback.
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot({ slots: [legacyAliceSlot()] })]);

      const stats = await recovery.run();

      expect(stats.entriesResumed).toBe(1);
      const adoptedEntry = coordinator.adoptRehydratedEntry.mock.calls[0]?.[0] as {
        slots: Array<{ personaId: string }>;
      };
      expect(adoptedEntry.slots[0]?.personaId).toBe('recovery-fallback-alice');
    });

    it('attaches the snapshot personaId on the terminal (non-pending) path too', async () => {
      // A slot already completed/errored before recovery ran goes through
      // buildPreservedTerminalSlot, which also reads the snapshot personaId —
      // so the preserved terminal message persists under the right persona.
      persistence.scanAllEntries.mockResolvedValue([
        buildSnapshot({
          slots: [{ ...legacyAliceSlot(), personaId: RESOLVED_PERSONA_ID, status: 'completed' }],
        }),
      ]);

      await recovery.run();

      const adoptedEntry = coordinator.adoptRehydratedEntry.mock.calls[0]?.[0] as {
        slots: Array<{ personaId: string }>;
      };
      expect(adoptedEntry.slots[0]?.personaId).toBe(RESOLVED_PERSONA_ID);
    });

    it('uses the snapshot personaId even when the personality is revoked', async () => {
      // Revoked-personality path: the slot is forced errored, but its personaId
      // still comes from the snapshot, so the synthetic-error message persists
      // under the user's own persona.
      personalityService.loadPersonality.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      await recovery.run();

      const adoptedEntry = coordinator.adoptRehydratedEntry.mock.calls[0]?.[0] as {
        slots: Array<{ personaId: string; status: string }>;
      };
      expect(adoptedEntry.slots[0]?.status).toBe('errored');
      expect(adoptedEntry.slots[0]?.personaId).toBe(RESOLVED_PERSONA_ID);
    });
  });

  describe('terminal slots in snapshot', () => {
    it('preserves slots already in completed/errored state without polling BullMQ', async () => {
      const snapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'completed',
          },
          {
            slotIndex: 1,
            personalityId: 'id-bob',
            personalitySlug: 'bob',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Bob',
            status: 'pending',
          },
        ],
      });
      persistence.scanAllEntries.mockResolvedValue([snapshot]);

      await recovery.run();

      // Only Bob's pending slot triggers a state poll; Alice's snapshot-terminal
      // slot is preserved as-is.
      expect(queue.getJob).toHaveBeenCalledOnce();
      expect(queue.getJob).toHaveBeenCalledWith('old-job-Bob');
    });
  });

  describe('empty + error paths', () => {
    it('reports zero stats and does not call coordinator when no entries exist', async () => {
      persistence.scanAllEntries.mockResolvedValue([]);

      const stats = await recovery.run();

      expect(stats.entriesScanned).toBe(0);
      expect(coordinator.adoptRehydratedEntry).not.toHaveBeenCalled();
      expect(coordinator.noteRecoveryMarkedStale).not.toHaveBeenCalled();
    });

    it('returns zero stats when scanAllEntries throws (graceful skip)', async () => {
      persistence.scanAllEntries.mockRejectedValue(new Error('Redis down'));

      const stats = await recovery.run();

      expect(stats.entriesScanned).toBe(0);
      expect(stats.entriesResumed).toBe(0);
    });

    it('continues recovering remaining entries when one entry throws', async () => {
      const snap1 = buildSnapshot({ groupId: 'g1', sourceMessageId: 'm1' });
      const snap2 = buildSnapshot({ groupId: 'g2', sourceMessageId: 'm2' });
      persistence.scanAllEntries.mockResolvedValue([snap1, snap2]);
      // First channel.fetch throws; second succeeds.
      discordClient.channels.fetch
        .mockRejectedValueOnce(new Error('unexpected'))
        .mockResolvedValueOnce(mockChannel as unknown as Channel);

      const stats = await recovery.run();

      // First entry: channel fetch threw → fetchTypingChannel returns null
      // → entry discarded. Second entry: succeeds normally.
      expect(stats.entriesScanned).toBe(2);
      expect(stats.entriesDiscarded + stats.entriesResumed).toBe(2);
    });
  });

  describe('coordinator notification', () => {
    it('does NOT call noteRecoveryMarkedStale when no entries are discarded and no stale marks happen', async () => {
      // Happy path: pending slots adopted with old jobIds, no stale marks
      // generated. The flag should stay off so MessageHandler's hot path
      // doesn't do unnecessary stale-set lookups.
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      await recovery.run();

      expect(coordinator.noteRecoveryMarkedStale).not.toHaveBeenCalled();
    });

    it('calls noteRecoveryMarkedStale when entries are discarded', async () => {
      // Channel gone → entry discarded → pending jobIds marked stale.
      discordClient.channels.fetch.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([buildSnapshot()]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(stats.staleJobIdsMarked).toBe(1);
      expect(coordinator.noteRecoveryMarkedStale).toHaveBeenCalledOnce();
    });

    it('calls noteRecoveryMarkedStale when entries are discarded even without stale jobIds', async () => {
      // Edge case the defensive `entriesDiscarded > 0` branch covers:
      // an entry with ONLY terminal slots gets discarded (e.g., channel
      // deleted). `discardEntry` won't mark any stale jobIds (no pending
      // slots), so `staleJobIdsMarked` stays 0 — but we still want the
      // fast-path flag flipped in case a delayed result arrives for one
      // of the terminal jobIds.
      const allTerminalSnapshot = buildSnapshot({
        slots: [
          {
            slotIndex: 0,
            personalityId: 'id-alice',
            personalitySlug: 'alice',
            source: 'mention',
            isAutoResponse: false,
            jobId: 'old-job-Alice',
            status: 'completed',
          },
        ],
      });
      discordClient.channels.fetch.mockResolvedValue(null);
      persistence.scanAllEntries.mockResolvedValue([allTerminalSnapshot]);

      const stats = await recovery.run();

      expect(stats.entriesDiscarded).toBe(1);
      expect(stats.staleJobIdsMarked).toBe(0);
      expect(coordinator.noteRecoveryMarkedStale).toHaveBeenCalledOnce();
    });
  });
});
