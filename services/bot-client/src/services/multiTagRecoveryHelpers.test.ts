/**
 * Tests for multiTagRecoveryHelpers — the BullMQ-state polling helper and
 * the synthetic failure-result constructor. Both extracted from
 * MultiTagRecovery.ts to keep the main service under the file-length cap.
 *
 * The helpers are tested independently from the recovery flow so a future
 * refactor that moves the call site won't lose coverage on the polling
 * state machine itself.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import { pollPriorJobState, synthesizeFailureResult } from './multiTagRecoveryHelpers.js';
import type { SlotSnapshot } from './MultiTagPersistence.js';

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
