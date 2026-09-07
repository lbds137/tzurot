/**
 * Memory-Archive Constants Tests
 *
 * Pins the shared prompt-version and BullMQ job-option constants — both
 * ai-worker's summarizer and packages/tooling's pre-warm sweep read these,
 * and a silent drift in either would desync the two queues or the
 * stale-summary re-sweep predicate.
 */

import { describe, it, expect } from 'vitest';
import { ARCHIVE_SUMMARY_PROMPT_VERSION, ARCHIVE_SUMMARY_JOB_OPTIONS } from './memoryArchive.js';

describe('ARCHIVE_SUMMARY_PROMPT_VERSION', () => {
  it('is pinned at 1 — bumping it is deliberate: it re-admits every done and dead row at retrieval and in the sweep', () => {
    expect(ARCHIVE_SUMMARY_PROMPT_VERSION).toBe(1);
  });
});

describe('ARCHIVE_SUMMARY_JOB_OPTIONS', () => {
  it('matches the exact shape shared by the live queue and the pre-warm sweep', () => {
    expect(ARCHIVE_SUMMARY_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  });
});
