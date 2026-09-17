/**
 * Recent-days digest constants — pins the status vocabulary and the sweep
 * cron pattern. `structure.test.ts` exempts `constants/` from requiring a
 * colocated test, but this pair is cheap to pin and the schedule test
 * (`scheduledJobSchedule.test.ts`) leans on `RECENT_DAYS_DIGEST_SWEEP_PATTERN`
 * being the exact string wired into the schedule.
 */

import { describe, it, expect } from 'vitest';
import {
  RECENT_DAYS_DIGEST_STATUS,
  RECENT_DAYS_DIGEST_SWEEP_PATTERN,
  RECENT_DAYS_DIGEST_SWEEP_JOB,
  RECENT_DAYS_DIGEST_PROMPT_VERSION,
} from './recentDaysDigest.js';

describe('RECENT_DAYS_DIGEST_STATUS', () => {
  it('is the exact four-state vocabulary the schema comment names', () => {
    expect(RECENT_DAYS_DIGEST_STATUS).toEqual({
      PENDING: 'pending',
      DONE: 'done',
      FAILED: 'failed',
      DEAD: 'dead',
    });
  });
});

describe('RECENT_DAYS_DIGEST_SWEEP_PATTERN', () => {
  it('is a 5-field cron pattern', () => {
    expect(RECENT_DAYS_DIGEST_SWEEP_PATTERN.split(' ')).toHaveLength(5);
  });

  it('is pinned to the :06 marks, offset from the roster-blurb sweep', () => {
    expect(RECENT_DAYS_DIGEST_SWEEP_PATTERN).toBe('6,16,26,36,46,56 * * * *');
  });
});

describe('RECENT_DAYS_DIGEST_SWEEP_JOB', () => {
  it('is a stable job name', () => {
    expect(RECENT_DAYS_DIGEST_SWEEP_JOB).toBe('recent-days-digest-sweep');
  });
});

describe('RECENT_DAYS_DIGEST_PROMPT_VERSION', () => {
  it('is pinned at 1 — bumping it is deliberate: it re-admits every row at selection time', () => {
    expect(RECENT_DAYS_DIGEST_PROMPT_VERSION).toBe(1);
  });
});
