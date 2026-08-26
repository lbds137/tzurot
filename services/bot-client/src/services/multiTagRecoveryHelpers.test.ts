/**
 * Tests for multiTagRecoveryHelpers — the BullMQ-state polling helper and
 * the synthetic failure-result constructor. Both extracted from
 * MultiTagRecovery.ts to keep the main service under the file-length cap.
 *
 * The helpers are tested independently from the recovery flow so a future
 * refactor that moves the call site won't lose coverage on the polling
 * state machine itself.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import {
  applyAlreadyDeliveredMarkers,
  buildRuntimeSlots,
  buildSentinelPersonality,
  discardRecoveredEntry,
  dispatchDeferredDeliveries,
  pollPriorJobState,
  recoverRealResultsAtDeadline,
  synthesizeFailureResult,
  tallyEntrySlots,
  type DeferredDelivery,
  type RecoveryStats,
} from './multiTagRecoveryHelpers.js';
import type { CoordinatorEntrySnapshot, SlotSnapshot } from './MultiTagPersistence.js';
import type { RuntimeSlot } from './multiTagCoordinatorHelpers.js';
import { confirmDelivery } from '../utils/gatewayServiceCalls.js';

// Only `confirmDelivery` is reached from this module; the rest of the gateway
// surface is deliberately absent so a new import would fail loudly here.
vi.mock('../utils/gatewayServiceCalls.js', () => ({
  confirmDelivery: vi.fn(),
}));

function buildSlotSnapshot(overrides: Partial<SlotSnapshot> = {}): SlotSnapshot {
  return {
    slotIndex: 0,
    personalityId: 'id-alice',
    personalitySlug: 'alice',
    source: 'mention',
    isAutoResponse: false,
    jobId: 'old-job-Alice',
    status: 'pending',
    ...overrides,
  };
}

/** Builder for the narrow BullMQ Job surface pollPriorJobState consumes. */
function buildMockJob(opts: {
  state: string;
  returnvalue?: LLMGenerationResult | null;
  failedReason?: string;
}): { getState: ReturnType<typeof vi.fn>; returnvalue?: unknown; failedReason?: string } {
  return {
    getState: vi.fn().mockResolvedValue(opts.state),
    returnvalue: opts.returnvalue,
    failedReason: opts.failedReason,
  };
}

function buildMockQueue(job: unknown): Queue {
  return {
    getJob: vi.fn().mockResolvedValue(job),
  } as unknown as Queue;
}

describe('pollPriorJobState', () => {
  it('returns completed with the returnvalue when the job is in completed state', async () => {
    const priorResult: LLMGenerationResult = {
      requestId: 'old-job-Alice',
      success: true,
      content: 'response from the prior process',
    };
    const queue = buildMockQueue(buildMockJob({ state: 'completed', returnvalue: priorResult }));

    const outcome = await pollPriorJobState(queue, 'old-job-Alice');

    expect(outcome).toEqual({ kind: 'completed', result: priorResult });
  });

  it('returns unrecoverable when a completed job has null returnvalue (removeOnComplete GC race)', async () => {
    const queue = buildMockQueue(buildMockJob({ state: 'completed', returnvalue: null }));

    const outcome = await pollPriorJobState(queue, 'old-job-Alice');

    expect(outcome).toEqual({ kind: 'unrecoverable' });
  });

  it('returns unrecoverable when a completed job has undefined returnvalue', async () => {
    const queue = buildMockQueue(buildMockJob({ state: 'completed', returnvalue: undefined }));

    const outcome = await pollPriorJobState(queue, 'old-job-Alice');

    expect(outcome).toEqual({ kind: 'unrecoverable' });
  });

  it('returns unrecoverable when returnvalue is non-object (architectural-guarantee violation)', async () => {
    // Defense-in-depth shape guard. If ai-worker ever returned a non-object
    // (e.g., a serialization regression that yielded a string), the cast
    // would propagate a malformed value to coordinator.handleJobResult.
    const queue = buildMockQueue({
      getState: vi.fn().mockResolvedValue('completed'),
      returnvalue: 'malformed-string' as unknown,
      failedReason: undefined,
    });

    const outcome = await pollPriorJobState(queue, 'old-job-Alice');

    expect(outcome).toEqual({ kind: 'unrecoverable' });
  });

  it("returns unrecoverable when returnvalue is an object missing the 'success' field", async () => {
    // Defense against an ai-worker contract change (e.g., envelope wrapping
    // the result) — anything that doesn't look like LLMGenerationResult
    // shape routes to unrecoverable.
    const queue = buildMockQueue({
      getState: vi.fn().mockResolvedValue('completed'),
      returnvalue: { unrelated: 'shape' } as unknown,
      failedReason: undefined,
    });

    const outcome = await pollPriorJobState(queue, 'old-job-Alice');

    expect(outcome).toEqual({ kind: 'unrecoverable' });
  });

  it('returns failed with the failedReason when the job is in failed state', async () => {
    const queue = buildMockQueue(buildMockJob({ state: 'failed', failedReason: 'OpenRouter 502' }));

    const outcome = await pollPriorJobState(queue, 'old-job-Alice');

    expect(outcome).toEqual({ kind: 'failed', failedReason: 'OpenRouter 502' });
  });

  it("returns failed with 'Unknown failure' when failedReason is missing", async () => {
    const queue = buildMockQueue(buildMockJob({ state: 'failed' }));

    const outcome = await pollPriorJobState(queue, 'old-job-Alice');

    expect(outcome).toEqual({ kind: 'failed', failedReason: 'Unknown failure' });
  });

  it.each(['active', 'waiting', 'waiting-children', 'delayed', 'prioritized'])(
    "returns inFlight for state '%s'",
    async (state: string) => {
      const queue = buildMockQueue(buildMockJob({ state }));

      const outcome = await pollPriorJobState(queue, 'old-job-Alice');

      expect(outcome).toEqual({ kind: 'inFlight' });
    }
  );

  it("returns unrecoverable for the 'unknown' state", async () => {
    const queue = buildMockQueue(buildMockJob({ state: 'unknown' }));

    const outcome = await pollPriorJobState(queue, 'old-job-Alice');

    expect(outcome).toEqual({ kind: 'unrecoverable' });
  });

  it('returns unrecoverable when queue.getJob returns null (job evicted from Redis)', async () => {
    const queue = buildMockQueue(null);

    const outcome = await pollPriorJobState(queue, 'old-job-Alice');

    expect(outcome).toEqual({ kind: 'unrecoverable' });
  });

  it('returns inFlight when queue.getJob throws (treat transient Redis blip as trust-the-stream)', async () => {
    const queue = {
      getJob: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
    } as unknown as Queue;

    const outcome = await pollPriorJobState(queue, 'old-job-Alice');

    expect(outcome).toEqual({ kind: 'inFlight' });
  });

  it('returns inFlight when job.getState throws (treat transient Redis blip as trust-the-stream)', async () => {
    const queue = buildMockQueue({
      getState: vi.fn().mockRejectedValue(new Error('Lost connection mid-call')),
      returnvalue: undefined,
      failedReason: undefined,
    });

    const outcome = await pollPriorJobState(queue, 'old-job-Alice');

    expect(outcome).toEqual({ kind: 'inFlight' });
  });
});

describe('synthesizeFailureResult', () => {
  it('builds a success:false LLMGenerationResult using the slot jobId as requestId', () => {
    const slotSnap = buildSlotSnapshot();

    const result = synthesizeFailureResult(slotSnap, 'OpenRouter 500');

    expect(result).toEqual({
      requestId: 'old-job-Alice',
      success: false,
      error: 'OpenRouter 500',
    });
  });

  it('preserves whatever error string the caller passes through (no normalization)', () => {
    const slotSnap = buildSlotSnapshot();

    const result = synthesizeFailureResult(slotSnap, 'Result unavailable after restart');

    expect(result.error).toBe('Result unavailable after restart');
    expect(result.success).toBe(false);
  });

  it('omits content (success:false consumers do not read it)', () => {
    const slotSnap = buildSlotSnapshot();

    const result = synthesizeFailureResult(slotSnap, 'whatever');

    expect(result.content).toBeUndefined();
  });
});

describe('recoverRealResultsAtDeadline', () => {
  const completedJob = (content: string): unknown =>
    buildMockJob({
      state: 'completed',
      returnvalue: { requestId: 'r', success: true, content },
    });

  it('skips slots whose jobs are still in flight and delivers only real outcomes', async () => {
    const queue = {
      getJob: vi
        .fn()
        .mockResolvedValueOnce(buildMockJob({ state: 'active' }))
        .mockResolvedValueOnce(completedJob('late result')),
    } as unknown as Queue;
    const deliver = vi.fn().mockResolvedValue(undefined);
    const entry = {
      groupId: 'group-1',
      slots: [
        { jobId: 'job-active', status: 'pending' },
        { jobId: 'job-done', status: 'pending' },
        { jobId: 'job-already-terminal', status: 'completed' },
      ],
    };

    await recoverRealResultsAtDeadline(queue, entry, deliver);

    // Only the pending slots are polled; only the real outcome delivers.
    expect(queue.getJob).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(
      'job-done',
      expect.objectContaining({ success: true, content: 'late result' })
    );
  });

  it('a throwing deliver never aborts the sweep — remaining slots still deliver', async () => {
    const queue = {
      getJob: vi
        .fn()
        .mockResolvedValueOnce(completedJob('first'))
        .mockResolvedValueOnce(completedJob('second')),
    } as unknown as Queue;
    const deliver = vi
      .fn()
      .mockRejectedValueOnce(new Error('persistence write blew up'))
      .mockResolvedValueOnce(undefined);
    const entry = {
      groupId: 'group-1',
      slots: [
        { jobId: 'job-a', status: 'pending' },
        { jobId: 'job-b', status: 'pending' },
      ],
    };

    // Must not throw. (With the real handleJobResult, the throwing slot is
    // usually already terminal with its real result — the sweep-continues
    // guarantee is what this test pins.)
    await expect(recoverRealResultsAtDeadline(queue, entry, deliver)).resolves.toBeUndefined();

    // The second slot's delivery still ran despite the first one throwing.
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenLastCalledWith(
      'job-b',
      expect.objectContaining({ content: 'second' })
    );
  });

  it('delivers an authoritative failure as a synthesized success:false result', async () => {
    const queue = {
      getJob: vi
        .fn()
        .mockResolvedValue(buildMockJob({ state: 'failed', failedReason: 'model exploded' })),
    } as unknown as Queue;
    const deliver = vi.fn().mockResolvedValue(undefined);
    const entry = {
      groupId: 'group-1',
      slots: [{ jobId: 'job-a', status: 'pending' }],
    };

    await recoverRealResultsAtDeadline(queue, entry, deliver);

    expect(deliver).toHaveBeenCalledWith('job-a', {
      requestId: 'job-a',
      success: false,
      error: 'model exploded',
    });
  });
});

describe('buildSentinelPersonality', () => {
  it('carries the four identity fields deliverError renders from the snapshot', () => {
    const snap = buildSlotSnapshot({ personalityId: 'id-bob', personalitySlug: 'bob' });

    const sentinel = buildSentinelPersonality(snap);

    expect(sentinel.id).toBe('id-bob');
    expect(sentinel.slug).toBe('bob');
    expect(sentinel.name).toBe('bob');
    expect(sentinel.displayName).toBe('bob');
  });
});

describe('applyAlreadyDeliveredMarkers', () => {
  function buildRuntimeSlot(overrides: Partial<RuntimeSlot> = {}): RuntimeSlot {
    return {
      slotIndex: 0,
      personality: buildSentinelPersonality(buildSlotSnapshot()),
      personaId: 'persona-1',
      source: 'mention',
      isAutoResponse: false,
      jobId: 'old-job-Alice',
      status: 'pending',
      ...overrides,
    };
  }

  function buildDelivery(overrides: Partial<DeferredDelivery> = {}): DeferredDelivery {
    return {
      jobId: 'old-job-Alice',
      result: { requestId: 'old-job-Alice', success: true, content: 'hi' },
      kind: 'recoveredCompleted',
      ...overrides,
    };
  }

  it('moves an already-delivered slot off pending so the safety timer cannot cover it', async () => {
    const slot = buildRuntimeSlot();
    const delivery = buildDelivery();

    const pass = await applyAlreadyDeliveredMarkers(
      [slot],
      [delivery],
      vi.fn().mockResolvedValue(true)
    );

    expect(slot.status).toBe('completed');
    expect(slot.alreadyDelivered).toBe(true);
    expect(pass.remainingDeliveries).toEqual([]);
    expect(pass.alreadyDeliveredCount).toBe(1);
  });

  it("marks a delivered failure slot 'errored', not 'completed'", async () => {
    const slot = buildRuntimeSlot();
    const delivery = buildDelivery({
      kind: 'recoveredFailed',
      result: { requestId: 'old-job-Alice', success: false, error: 'boom' },
    });

    await applyAlreadyDeliveredMarkers([slot], [delivery], vi.fn().mockResolvedValue(true));

    expect(slot.status).toBe('errored');
  });

  it('leaves an undelivered slot pending and keeps its deferred delivery', async () => {
    const slot = buildRuntimeSlot();
    const delivery = buildDelivery();

    const pass = await applyAlreadyDeliveredMarkers(
      [slot],
      [delivery],
      vi.fn().mockResolvedValue(false)
    );

    expect(slot.status).toBe('pending');
    expect(slot.alreadyDelivered).toBeUndefined();
    expect(pass.remainingDeliveries).toEqual([delivery]);
    expect(pass.alreadyDeliveredCount).toBe(0);
  });

  it('gives a delivered pending slot a terminal status so the safety timer cannot cover it', async () => {
    // Pending with no deferred delivery LOOKS like a live job, but a state-poll
    // error produces the same shape — so the marker decides, and a slot the
    // marker claims must not be handed back to the timer still pending.
    const slot = buildRuntimeSlot();
    const isSlotDelivered = vi.fn().mockResolvedValue(true);

    const pass = await applyAlreadyDeliveredMarkers([slot], [], isSlotDelivered);

    expect(isSlotDelivered).toHaveBeenCalledWith('old-job-Alice');
    expect(slot.status).toBe('completed');
    expect(slot.alreadyDelivered).toBe(true);
    expect(pass.alreadyDeliveredCount).toBe(1);
  });

  it('leaves a genuinely in-flight slot pending when no marker exists', async () => {
    const slot = buildRuntimeSlot();
    const isSlotDelivered = vi.fn().mockResolvedValue(false);

    const pass = await applyAlreadyDeliveredMarkers([slot], [], isSlotDelivered);

    expect(isSlotDelivered).toHaveBeenCalledWith('old-job-Alice');
    expect(slot.status).toBe('pending');
    expect(slot.alreadyDelivered).toBeUndefined();
    expect(pass.alreadyDeliveredCount).toBe(0);
    expect(pass.deliveredTrustedToStreamCount).toBe(0);
  });

  it('reports a delivered no-delivery pending slot under deliveredTrustedToStreamCount', async () => {
    // Three delivered slots of DIFFERENT shapes so the count can distinguish
    // "the trusted-to-stream overlap" from "every delivered slot":
    // pending-without-delivery (the overlap), pending-with-delivery, and an
    // already-terminal snapshot slot.
    const pendingNoDelivery = buildRuntimeSlot({ jobId: 'job-inflight' });
    const pendingWithDelivery = buildRuntimeSlot({ slotIndex: 1, jobId: 'job-completed' });
    const terminalSnapshotSlot = buildRuntimeSlot({
      slotIndex: 2,
      jobId: 'job-terminal',
      status: 'errored',
    });

    const pass = await applyAlreadyDeliveredMarkers(
      [pendingNoDelivery, pendingWithDelivery, terminalSnapshotSlot],
      [buildDelivery({ jobId: 'job-completed' })],
      vi.fn().mockResolvedValue(true)
    );

    expect(pass.alreadyDeliveredCount).toBe(3);
    expect(pass.deliveredTrustedToStreamCount).toBe(1);
  });

  it('checks an already-terminal snapshot slot, which carries no deferred delivery', async () => {
    // A slot the snapshot already recorded as terminal still flushes through
    // deliverGroup, so a prior run's delivery of it must be honoured too.
    const slot = buildRuntimeSlot({ status: 'errored' });
    const isSlotDelivered = vi.fn().mockResolvedValue(true);

    const pass = await applyAlreadyDeliveredMarkers([slot], [], isSlotDelivered);

    expect(isSlotDelivered).toHaveBeenCalledWith('old-job-Alice');
    expect(slot.alreadyDelivered).toBe(true);
    expect(slot.status).toBe('errored');
    expect(pass.alreadyDeliveredCount).toBe(1);
  });

  it('handles a mixed entry per-slot', async () => {
    const alice = buildRuntimeSlot({ jobId: 'old-job-Alice' });
    const bob = buildRuntimeSlot({ slotIndex: 1, jobId: 'old-job-Bob' });
    const aliceDelivery = buildDelivery({ jobId: 'old-job-Alice' });
    const bobDelivery = buildDelivery({
      jobId: 'old-job-Bob',
      result: { requestId: 'old-job-Bob', success: true, content: 'bob' },
    });

    const pass = await applyAlreadyDeliveredMarkers(
      [alice, bob],
      [aliceDelivery, bobDelivery],
      vi.fn().mockImplementation(async (jobId: string) => jobId === 'old-job-Alice')
    );

    expect(alice.status).toBe('completed');
    expect(alice.alreadyDelivered).toBe(true);
    expect(bob.status).toBe('pending');
    expect(bob.alreadyDelivered).toBeUndefined();
    expect(pass.remainingDeliveries).toEqual([bobDelivery]);
    expect(pass.alreadyDeliveredCount).toBe(1);
  });
});

describe('tallyEntrySlots', () => {
  function delivery(jobId: string, kind: DeferredDelivery['kind']): DeferredDelivery {
    return { jobId, result: { requestId: jobId, success: true, content: 'x' }, kind };
  }

  function buildStats(): RecoveryStats {
    return {
      entriesScanned: 0,
      entriesResumed: 0,
      entriesDiscarded: 0,
      entriesExpiredSilent: 0,
      slotsRecoveredCompleted: 0,
      slotsRecoveredFailed: 0,
      slotsTrustedToStream: 0,
      slotsUnrecoverable: 0,
      slotsAccessRevoked: 0,
      staleJobIdsMarked: 0,
      slotsAlreadyDelivered: 0,
    };
  }

  it('buckets the surviving deliveries by kind and passes the other two counts through', () => {
    const counts = tallyEntrySlots(
      buildStats(),
      [
        delivery('a', 'recoveredCompleted'),
        delivery('b', 'recoveredCompleted'),
        // Distinct per-kind totals: equal counts would let a swapped
        // predicate produce the same object and pass.
        delivery('c', 'recoveredFailed'),
        delivery('d', 'recoveredFailed'),
        delivery('e', 'recoveredFailed'),
        delivery('f', 'unrecoverable'),
      ],
      4,
      5
    );

    expect(counts).toEqual({
      slotsRecoveredCompleted: 2,
      slotsRecoveredFailed: 3,
      slotsUnrecoverable: 1,
      slotsTrustedToStream: 4,
      slotsAlreadyDelivered: 5,
    });
  });

  it('counts nothing under the poll outcomes when every delivery was already sent', () => {
    // The caller passes the POST-marker-pass list, so an entry whose slots
    // were all delivered by a prior run contributes to slotsAlreadyDelivered
    // alone — this is the disjointness the aggregate RecoveryStats relies on.
    const counts = tallyEntrySlots(buildStats(), [], 0, 2);

    expect(counts.slotsAlreadyDelivered).toBe(2);
    expect(counts.slotsRecoveredCompleted).toBe(0);
    expect(counts.slotsRecoveredFailed).toBe(0);
    expect(counts.slotsUnrecoverable).toBe(0);
  });

  it('accumulates into the run-level stats across entries rather than overwriting', () => {
    // The aggregate is a sum over entries: a second entry's outcomes must add
    // to the first's, and the returned per-entry object must stay per-entry so
    // the 'Multi-tag entry rehydrated' log describes one entry, not the run.
    const stats = buildStats();

    tallyEntrySlots(stats, [delivery('a', 'recoveredCompleted')], 1, 2);
    const second = tallyEntrySlots(stats, [delivery('b', 'recoveredCompleted')], 3, 4);

    expect(stats.slotsRecoveredCompleted).toBe(2);
    expect(stats.slotsTrustedToStream).toBe(4);
    expect(stats.slotsAlreadyDelivered).toBe(6);
    expect(second.slotsRecoveredCompleted).toBe(1);
    expect(second.slotsTrustedToStream).toBe(3);
    expect(second.slotsAlreadyDelivered).toBe(4);
  });
});

describe('buildRuntimeSlots', () => {
  function slotFor(jobId: string, status: RuntimeSlot['status']): RuntimeSlot {
    return {
      slotIndex: 0,
      personality: buildSentinelPersonality(buildSlotSnapshot()),
      personaId: 'persona-1',
      source: 'mention',
      isAutoResponse: false,
      jobId,
      status,
    };
  }

  it('separates deferred deliveries from trusted-to-stream slots', async () => {
    // Three DIFFERENT shapes, one each: a pending slot carrying a delivery, a
    // pending slot without one, and a terminal slot without one. A fixture with
    // one shape repeated could not tell "counts inFlight slots" apart from
    // "counts every delivery-less slot".
    const snaps = [
      buildSlotSnapshot({ jobId: 'job-a' }),
      buildSlotSnapshot({ jobId: 'job-b', slotIndex: 1 }),
      buildSlotSnapshot({ jobId: 'job-c', slotIndex: 2, status: 'errored' }),
    ];

    const built = await buildRuntimeSlots(snaps, async snap => {
      if (snap.jobId === 'job-a') {
        return {
          slot: slotFor('job-a', 'pending'),
          deferredDelivery: {
            jobId: 'job-a',
            result: { requestId: 'job-a', success: true, content: 'hi' },
            kind: 'recoveredCompleted' as const,
          },
        };
      }
      if (snap.jobId === 'job-b') {
        return { slot: slotFor('job-b', 'pending') };
      }
      return { slot: slotFor('job-c', 'errored') };
    });

    expect(built.runtimeSlots.map(s => s.jobId)).toEqual(['job-a', 'job-b', 'job-c']);
    expect(built.deferredDeliveries.map(d => d.jobId)).toEqual(['job-a']);
    // Only job-b: job-a has a delivery, job-c is terminal.
    expect(built.trustedToStreamCount).toBe(1);
  });
});

describe('dispatchDeferredDeliveries', () => {
  function delivery(jobId: string): DeferredDelivery {
    return {
      jobId,
      result: { requestId: jobId, success: true, content: 'hi' },
      kind: 'recoveredCompleted',
    };
  }

  it('forwards each delivery to the deliver callback in order', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);

    await dispatchDeferredDeliveries('group-1', [delivery('job-a'), delivery('job-b')], deliver);

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[0][0]).toBe('job-a');
    expect(deliver.mock.calls[0][1]).toEqual({
      requestId: 'job-a',
      success: true,
      content: 'hi',
    });
    expect(deliver.mock.calls[1][0]).toBe('job-b');
  });

  it('continues with the remaining deliveries when one throws', async () => {
    const deliver = vi
      .fn()
      .mockRejectedValueOnce(new Error('persistence write failed'))
      .mockResolvedValue(undefined);

    await expect(
      dispatchDeferredDeliveries('group-1', [delivery('job-a'), delivery('job-b')], deliver)
    ).resolves.toBeUndefined();

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[1][0]).toBe('job-b');
  });
});

describe('discardRecoveredEntry', () => {
  function buildStats(): RecoveryStats {
    return {
      entriesScanned: 0,
      entriesResumed: 0,
      entriesDiscarded: 0,
      entriesExpiredSilent: 0,
      slotsRecoveredCompleted: 0,
      slotsRecoveredFailed: 0,
      slotsTrustedToStream: 0,
      slotsUnrecoverable: 0,
      slotsAccessRevoked: 0,
      staleJobIdsMarked: 0,
      slotsAlreadyDelivered: 0,
    };
  }

  function buildSnapshot(): CoordinatorEntrySnapshot {
    return {
      groupId: 'group-1',
      sourceMessageId: 'msg-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      userId: 'user-1',
      userMessageTime: '2026-05-15T10:00:00Z',
      userMessageContent: 'hi everyone',
      slots: [
        buildSlotSnapshot({ jobId: 'job-delivered', status: 'completed' }),
        buildSlotSnapshot({ jobId: 'job-pending', slotIndex: 1, status: 'pending' }),
      ],
      createdAt: Date.now(),
      truncated: false,
      maxTags: 5,
    };
  }

  function buildPersistence(): {
    markStale: ReturnType<typeof vi.fn>;
    deleteEntry: ReturnType<typeof vi.fn>;
  } {
    return {
      markStale: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined),
    };
  }

  beforeEach(() => {
    vi.mocked(confirmDelivery).mockReset();
    vi.mocked(confirmDelivery).mockResolvedValue(undefined);
  });

  it('marks pending jobIds stale, confirms only the delivered ones, and deletes the entry', async () => {
    // The two slots differ deliberately: one delivered-and-terminal, one
    // still pending. A same-shape pair could not show that stale-marking and
    // delivery-confirmation select DIFFERENT slots.
    const persistence = buildPersistence();
    const stats = buildStats();

    await discardRecoveredEntry({
      persistence: persistence as unknown as Parameters<
        typeof discardRecoveredEntry
      >[0]['persistence'],
      snapshot: buildSnapshot(),
      reason: 'every slot already delivered by a prior run',
      stats,
      deliveredJobIds: ['job-delivered'],
    });

    expect(persistence.markStale).toHaveBeenCalledWith('job-pending');
    expect(vi.mocked(confirmDelivery)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirmDelivery)).toHaveBeenCalledWith('job-delivered');
    expect(vi.mocked(confirmDelivery)).not.toHaveBeenCalledWith('job-pending');
    expect(persistence.deleteEntry).toHaveBeenCalledOnce();
    expect(stats.entriesDiscarded).toBe(1);
    expect(stats.staleJobIdsMarked).toBe(1);
  });

  it('still deletes the entry when a confirm rejects', async () => {
    const persistence = buildPersistence();
    vi.mocked(confirmDelivery).mockRejectedValue(new Error('gateway down'));

    await expect(
      discardRecoveredEntry({
        persistence: persistence as unknown as Parameters<
          typeof discardRecoveredEntry
        >[0]['persistence'],
        snapshot: buildSnapshot(),
        reason: 'channel unavailable',
        stats: buildStats(),
        deliveredJobIds: ['job-delivered'],
      })
    ).resolves.toBeUndefined();

    expect(persistence.deleteEntry).toHaveBeenCalledOnce();
  });
});
