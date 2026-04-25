// Tests for the job age gate helper.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { checkQueueAge, MAX_QUEUE_AGE_MS } from './jobAgeGate.js';
import { ExpiredJobError } from './attachmentFetch.js';

function mockLogger(): Logger {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function mockJob(timestamp: number, id: string = 'job-test'): Pick<Job, 'id' | 'timestamp'> {
  return { id, timestamp };
}

describe('checkQueueAge', () => {
  // Pinned clock per project standard (02-code-standards.md "Fake Timers
  // ALWAYS Use"). With the system time fixed, both `Date.now() - X` reads
  // (the test fixture's anchor and the helper's internal one) are
  // deterministic, eliminating any chance of clock-drift flakiness.
  // `toFake: ['Date']` matches the sibling test files' convention — fakes
  // only Date, leaves setTimeout/setInterval real.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
  });

  // Both teardowns matter: `useRealTimers` actually resets the fake clock
  // (which `restoreAllMocks` does NOT do), and `restoreAllMocks` resets
  // any spies created inside individual tests.
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is a no-op for jobs newer than the threshold', () => {
    const job = mockJob(Date.now() - 60_000); // 1 min old
    const logger = mockLogger();
    expect(() => checkQueueAge(job, logger)).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('throws ExpiredJobError when job age exceeds the default threshold (just-over)', () => {
    // +1 min over the threshold — tests "just over" relative to MAX_QUEUE_AGE_MS
    // so the test stays meaningful if the threshold is ever tuned, instead of
    // silently over-testing at a fixed delta.
    const job = mockJob(Date.now() - MAX_QUEUE_AGE_MS - 60_000);
    const logger = mockLogger();
    expect(() => checkQueueAge(job, logger)).toThrow(ExpiredJobError);
  });

  it('does NOT throw at exactly the threshold (pins `>` vs `>=` semantics)', () => {
    // The gate uses strict greater-than: `queueAgeMs > maxAgeMs`. A job at
    // exactly MAX_QUEUE_AGE_MS should pass cleanly. This test would catch a
    // regression if the comparison ever changes to `>=`, which would create
    // a ~1ms window where jobs precisely at the threshold get false-rejected.
    const job = mockJob(Date.now() - MAX_QUEUE_AGE_MS);
    const logger = mockLogger();
    expect(() => checkQueueAge(job, logger)).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs a structured warn with jobId and exact queueAgeMs when throwing', () => {
    // With the clock pinned, queueAgeMs is deterministic — assert the exact
    // value (MAX_QUEUE_AGE_MS + 60_000) instead of `expect.any(Number)`.
    const job = mockJob(Date.now() - MAX_QUEUE_AGE_MS - 60_000, 'job-xyz');
    const logger = mockLogger();
    expect(() => checkQueueAge(job, logger)).toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      {
        jobId: 'job-xyz',
        maxQueueAgeMs: MAX_QUEUE_AGE_MS,
        queueAgeMs: MAX_QUEUE_AGE_MS + 60_000,
      },
      expect.stringMatching(/exceeded queue-age threshold/)
    );
  });

  it('honors a custom maxAgeMs override', () => {
    // Override the default when a job family needs a tighter or looser
    // threshold. This pins the parameter as actually used (not just present).
    const fiveSecondsOld = mockJob(Date.now() - 5_000);
    const logger = mockLogger();
    // 1-second threshold: 5s > 1s → should throw.
    expect(() => checkQueueAge(fiveSecondsOld, logger, 1_000)).toThrow(ExpiredJobError);
    // 10-second threshold: 5s < 10s → should not throw.
    expect(() => checkQueueAge(fiveSecondsOld, logger, 10_000)).not.toThrow();
  });
});
