/**
 * Tests for message constants.
 *
 * These assert the timing invariants the MULTI_TAG coordinator depends on.
 * They previously lived only as JSDoc prose in message.ts — nothing failed if
 * a future edit broke them. Locking them in here means a change to one constant
 * that violates the relationship fails CI instead of misbehaving in production.
 */

import { describe, it, expect } from 'vitest';
import { MULTI_TAG, NO_TEXT_CONTENT_PLACEHOLDER } from './message.js';
import { TIMEOUTS } from './timing.js';

describe('MULTI_TAG timing invariants', () => {
  it('coordinator timeout is at least the ordering buffer wait', () => {
    // The per-channel ordering buffer must not force-process a group before the
    // coordinator backstop fires; otherwise late slots get dropped. Keeping the
    // coordinator budget >= the ordering wait guarantees the backstop is last.
    expect(MULTI_TAG.COORDINATOR_TIMEOUT_MS).toBeGreaterThanOrEqual(MULTI_TAG.ORDERING_MAX_WAIT_MS);
  });

  it('worker lock (stall detection) fires well before the coordinator flush', () => {
    // A deploy-killed job must stall-recover and re-run with time to complete
    // BEFORE the coordinator's last-resort flush synthesizes an error. The lock
    // is dead-process detection (auto-renewed while the worker lives), so it
    // must sit far below the flush window; if this inverts, orphaned jobs wedge
    // until the flush again and the stall re-run becomes pure wasted spend.
    expect(TIMEOUTS.WORKER_LOCK_DURATION).toBeLessThan(MULTI_TAG.COORDINATOR_TIMEOUT_MS);
  });

  it('coordinator timeout stays under the in-process job runtime ceiling', () => {
    // The flush is sized above legitimate long-job runtimes but below the
    // runtime ceiling — past MAX_JOB_RUNTIME every live job has already been
    // timed out in-process and delivered a real error, so a flush later than
    // that could only ever synthesize noise.
    expect(MULTI_TAG.COORDINATOR_TIMEOUT_MS).toBeLessThan(TIMEOUTS.MAX_JOB_RUNTIME);
  });

  it('Redis TTL outlives the coordinator safety window', () => {
    // REDIS_TTL_SEC bounds the coordinator snapshots, the synthetic-timeout
    // recovery markers, AND the ai-worker's stored TTS audio. All three must
    // survive a full safety window: a reply held in the ordered-delivery
    // buffer behind a wedged group delivers only at the safety flush, and if
    // its audio expired first the reply arrives voiceless.
    expect(MULTI_TAG.REDIS_TTL_SEC * 1000).toBeGreaterThan(MULTI_TAG.COORDINATOR_TIMEOUT_MS);
  });
});

describe('NO_TEXT_CONTENT_PLACEHOLDER', () => {
  it('matches the exact sentinel already persisted in production rows', () => {
    // Existing rows poisoned by the forwarded-content-loss bug store this exact
    // string. The recovery guard compares against it to re-heal them, so the
    // value must not drift — changing it orphans every poisoned row from recovery.
    expect(NO_TEXT_CONTENT_PLACEHOLDER).toBe('[no text content]');
  });
});
