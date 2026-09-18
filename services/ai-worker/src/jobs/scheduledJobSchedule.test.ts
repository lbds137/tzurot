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

  /** Expand a cron minute field (`*`, `N`, `a,b,c`, or a step field) to the
   *  set of minutes it fires on. A bare `*` has no finite expansion — the
   *  caller asserts no row in this schedule uses one instead of expanding it. */
  function expandMinuteField(field: string): number[] {
    if (field === '*') {
      throw new Error('bare * minute field has no finite expansion');
    }
    if (field.startsWith('*/')) {
      const step = Number(field.slice(2));
      const minutes: number[] = [];
      for (let m = 0; m < 60; m += step) {
        minutes.push(m);
      }
      return minutes;
    }
    return field.split(',').map(Number);
  }

  it('the retention row is daily, and its minute mark is unique across the schedule', () => {
    const retentionRow = REPEATABLE_JOB_SCHEDULE.find(
      job => job.name === SCHEDULED_JOBS.RECENT_DAYS_DIGEST_RETENTION
    );
    expect(retentionRow).toBeDefined();

    const [minuteField, hourField, domField, monthField, dowField] =
      retentionRow!.pattern.split(' ');
    // Daily: hour is a fixed value, day-of-month/month/day-of-week are `*`.
    expect(hourField).not.toBe('*');
    expect(domField).toBe('*');
    expect(monthField).toBe('*');
    expect(dowField).toBe('*');

    for (const { name, pattern } of REPEATABLE_JOB_SCHEDULE) {
      const otherMinuteField = pattern.split(' ')[0];
      expect(otherMinuteField, `minute field for ${name}`).not.toBe('*');
    }

    const retentionMinutes = new Set(expandMinuteField(minuteField));
    for (const { name, pattern } of REPEATABLE_JOB_SCHEDULE) {
      if (name === SCHEDULED_JOBS.RECENT_DAYS_DIGEST_RETENTION) {
        continue;
      }
      const otherMinutes = expandMinuteField(pattern.split(' ')[0]);
      const overlap = otherMinutes.filter(m => retentionMinutes.has(m));
      expect(overlap, `overlap between retention and ${name}`).toEqual([]);
    }
  });
});
