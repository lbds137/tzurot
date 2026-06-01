/**
 * Tests for message constants.
 *
 * These assert the timing invariants the MULTI_TAG coordinator depends on.
 * They previously lived only as JSDoc prose in message.ts — nothing failed if
 * a future edit broke them. Locking them in here means a change to one constant
 * that violates the relationship fails CI instead of misbehaving in production.
 */

import { describe, it, expect } from 'vitest';
import { MULTI_TAG } from './message.js';
import { TIMEOUTS } from './timing.js';

describe('MULTI_TAG timing invariants', () => {
  it('coordinator timeout is at least the ordering buffer wait', () => {
    // The per-channel ordering buffer must not force-process a group before the
    // coordinator backstop fires; otherwise late slots get dropped. Keeping the
    // coordinator budget >= the ordering wait guarantees the backstop is last.
    expect(MULTI_TAG.COORDINATOR_TIMEOUT_MS).toBeGreaterThanOrEqual(MULTI_TAG.ORDERING_MAX_WAIT_MS);
  });

  it('coordinator timeout stays under the worker lock duration', () => {
    // The bot-side coordinator wait must finish before the worker lock expires,
    // or the lock can be reclaimed mid-coordination and two replicas race.
    expect(MULTI_TAG.COORDINATOR_TIMEOUT_MS).toBeLessThan(TIMEOUTS.WORKER_LOCK_DURATION);
  });
});
