import { describe, it, expect } from 'vitest';
import { RECENT_DAYS_DIGEST_SWEEP_PATTERN } from '@tzurot/common-types/constants/recentDaysDigest';
import { SCHEDULED_JOBS, REPEATABLE_JOB_SCHEDULE } from './scheduledJobSchedule.js';

const CRON_FIELD_COUNT = 5;

describe('REPEATABLE_JOB_SCHEDULE', () => {
  it('every pattern parses as a 5-field cron expression', () => {
    for (const { name, pattern } of REPEATABLE_JOB_SCHEDULE) {
      expect(pattern.split(' '), `pattern for ${name}`).toHaveLength(CRON_FIELD_COUNT);
    }
  });

  it('carries the digest sweep row at RECENT_DAYS_DIGEST_SWEEP_PATTERN', () => {
    const digestRow = REPEATABLE_JOB_SCHEDULE.find(
      job => job.name === SCHEDULED_JOBS.RECENT_DAYS_DIGEST_SWEEP
    );
    expect(digestRow?.pattern).toBe(RECENT_DAYS_DIGEST_SWEEP_PATTERN);
  });

  it('shares no minute mark with the roster-blurb sweep', () => {
    const digestRow = REPEATABLE_JOB_SCHEDULE.find(
      job => job.name === SCHEDULED_JOBS.RECENT_DAYS_DIGEST_SWEEP
    );
    const blurbRow = REPEATABLE_JOB_SCHEDULE.find(
      job => job.name === SCHEDULED_JOBS.ROSTER_BLURB_SWEEP
    );
    const digestMinutes = new Set(digestRow?.pattern.split(' ')[0].split(','));
    const blurbMinutes = new Set(blurbRow?.pattern.split(' ')[0].split(','));
    const overlap = [...digestMinutes].filter(m => blurbMinutes.has(m));
    expect(overlap).toEqual([]);
  });
});
