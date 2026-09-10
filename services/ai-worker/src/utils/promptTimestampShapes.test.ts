/**
 * Tests for the prompt-timestamp bracket pattern.
 *
 * Every "strip" case round-trips through the REAL formatter from
 * `@tzurot/common-types/utils/dateFormatting` — the fixture is never a
 * hand-typed string that merely resembles a formatter's output — so a
 * formatter change that drifts the shape is caught here rather than only at
 * the seam layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatRelativeTime,
  formatRelativeTimeDelta,
  formatAbsoluteTimestamp,
  formatPromptTimestamp,
  formatMemoryTimestamp,
  formatFullDateTime,
} from '@tzurot/common-types/utils/dateFormatting';
import { PROMPT_TIMESTAMP_BRACKET_PATTERN } from './promptTimestampShapes.js';

const NY = 'America/New_York';

/** Round-trip a formatter's stamp through the pattern under test. */
function assertStrips(stamp: string): void {
  expect(`[${stamp}] Hello`.replace(PROMPT_TIMESTAMP_BRACKET_PATTERN, '')).toBe('Hello');
}

describe('PROMPT_TIMESTAMP_BRACKET_PATTERN', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T15:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatRelativeTime branches', () => {
    it.each([
      ['just now', 10_000, (s: string) => expect(s).toBe('just now')],
      ['Nm ago (minutes)', 5 * 60_000, (s: string) => expect(s).toMatch(/^\d+m ago$/)],
      ['Nh ago (hours)', 3 * 3_600_000, (s: string) => expect(s).toMatch(/^\d+h ago$/)],
      ['Nd ago (days)', 3 * 86_400_000, (s: string) => expect(s).toMatch(/^\d+d ago$/)],
      [
        'ISO date fallback (>= 7d)',
        20 * 86_400_000,
        (s: string) => expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/),
      ],
    ] as const)('%s', (_label, agoMs, assertBranch) => {
      const date = new Date(Date.now() - agoMs);
      const stamp = formatRelativeTime(date, NY);
      assertBranch(stamp);
      assertStrips(stamp);
    });
  });

  describe('formatRelativeTimeDelta branches', () => {
    it.each([
      ['just now', 10_000, (s: string) => expect(s).toBe('just now')],
      ['1 minute ago', 61_000, (s: string) => expect(s).toBe('1 minute ago')],
      ['5 minutes ago', 5 * 60_000, (s: string) => expect(s).toBe('5 minutes ago')],
      ['1 hour ago', 61 * 60_000, (s: string) => expect(s).toBe('1 hour ago')],
      ['3 hours ago', 3 * 3_600_000, (s: string) => expect(s).toBe('3 hours ago')],
      ['yesterday', 25 * 3_600_000, (s: string) => expect(s).toBe('yesterday')],
      ['3 days ago', 3 * 86_400_000, (s: string) => expect(s).toBe('3 days ago')],
      ['1 week ago', 8 * 86_400_000, (s: string) => expect(s).toBe('1 week ago')],
      ['2 weeks ago', 15 * 86_400_000, (s: string) => expect(s).toBe('2 weeks ago')],
      ['1 month ago', 35 * 86_400_000, (s: string) => expect(s).toBe('1 month ago')],
      ['3 months ago', 100 * 86_400_000, (s: string) => expect(s).toBe('3 months ago')],
      ['1 year ago', 400 * 86_400_000, (s: string) => expect(s).toBe('1 year ago')],
      ['2 years ago', 800 * 86_400_000, (s: string) => expect(s).toBe('2 years ago')],
      ['in the future', -3_600_000, (s: string) => expect(s).toBe('in the future')],
    ] as const)('%s', (_label, agoMs, assertBranch) => {
      const date = new Date(Date.now() - agoMs);
      const stamp = formatRelativeTimeDelta(date);
      assertBranch(stamp);
      assertStrips(stamp);
    });
  });

  describe('formatAbsoluteTimestamp', () => {
    it('renders and strips the "YYYY-MM-DD (Day) HH:MM" shape', () => {
      const date = new Date(Date.now() - 3 * 3_600_000);
      const stamp = formatAbsoluteTimestamp(date, NY);
      expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2} \([A-Za-z]{3}\) \d{2}:\d{2}$/);
      assertStrips(stamp);
    });
  });

  describe('formatPromptTimestamp branches', () => {
    it('renders and strips the with-time form (< 7 days)', () => {
      const date = new Date(Date.now() - 3 * 3_600_000);
      const stamp = formatPromptTimestamp(date, NY);
      expect(stamp).toMatch(/\d{2}:\d{2}/);
      assertStrips(stamp);
    });

    it('renders and strips the without-time form (>= 7 days)', () => {
      const date = new Date(Date.now() - 20 * 86_400_000);
      const stamp = formatPromptTimestamp(date, NY);
      expect(stamp).not.toMatch(/\d{2}:\d{2}/);
      assertStrips(stamp);
    });
  });

  describe('formatMemoryTimestamp', () => {
    it('renders and strips the "Day, Mon D, YYYY" shape', () => {
      const date = new Date(Date.now() - 3 * 86_400_000);
      const stamp = formatMemoryTimestamp(date, NY);
      expect(stamp).toMatch(/^[A-Za-z]{3}, [A-Za-z]{3} \d{1,2}, \d{4}$/);
      assertStrips(stamp);
    });
  });

  describe('formatFullDateTime branches', () => {
    it.each(['America/New_York', 'UTC', 'Asia/Kolkata'] as const)(
      'renders and strips in timezone %s',
      tz => {
        const date = new Date();
        const stamp = formatFullDateTime(date, tz);
        expect(stamp).toMatch(/^[A-Za-z]+, [A-Za-z]+ \d{1,2}, \d{4}/);
        assertStrips(stamp);
      }
    );
  });

  describe('keep cases — not a prompt-timestamp shape', () => {
    it.each([
      '[laughs] Anyway, no.',
      '[Sat 18:19] Hello',
      '[now] hello',
      '[Just now] hi',
      '[2m ago',
      '[5m ago, maybe] hi',
      '[2026-01-01 extra] hi',
      'x [2m ago] hi',
      '[3 hours] later',
    ])('leaves %j unchanged', input => {
      expect(input.replace(PROMPT_TIMESTAMP_BRACKET_PATTERN, '')).toBe(input);
    });
  });

  describe('adversarial performance: no catastrophic backtracking', () => {
    // The pattern uses only bounded quantifiers except the trailing `\s*`, so
    // none of these inputs should cost more than a linear scan. 100ms leaves
    // enormous headroom over a linear-time match while staying tight enough
    // to redden on a real backtracking regression (same idiom as
    // RealMessagesBuilder.test.ts's adversarial-perf suite).
    beforeEach(() => {
      vi.useRealTimers();
    });

    it.each([
      ['1 + 50k digit-like chars, unclosed', `[${'1'.repeat(50_000)}`],
      ['1 + 50k spaces, unclosed', `[${' '.repeat(50_000)}`],
      ['5k repeats of an incomplete absolute-date prefix', '[2026-01-01 (Mon) '.repeat(5_000)],
      ['1 + 5k repeats of a relative-delta phrase, unclosed', `[${'1 minute ago'.repeat(5_000)}`],
    ])('resolves %s in well under a second', (_label, input) => {
      const start = performance.now();
      const matched = PROMPT_TIMESTAMP_BRACKET_PATTERN.test(input);
      const elapsedMs = performance.now() - start;
      expect(matched).toBe(false);
      expect(elapsedMs).toBeLessThan(100);
    });
  });
});
