import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatFullDateTime,
  formatDateOnly,
  formatRelativeTime,
  formatMemoryTimestamp,
  formatRelativeTimeDelta,
  formatTimestampWithDelta,
  formatPromptTimestamp,
} from './dateFormatting.js';

describe('dateFormatting', () => {
  describe('formatFullDateTime', () => {
    it('should format a date with full context', () => {
      // Use a fixed date to avoid timezone issues
      const date = new Date('2025-01-27T12:45:00Z');
      const result = formatFullDateTime(date, 'UTC');

      expect(result).toContain('Monday');
      expect(result).toContain('January');
      expect(result).toContain('27');
      expect(result).toContain('2025');
    });

    it('should handle string input', () => {
      const result = formatFullDateTime('2025-01-27T12:45:00Z', 'UTC');
      expect(result).toContain('January');
    });

    it('should handle numeric timestamp input', () => {
      const timestamp = new Date('2025-01-27T12:45:00Z').getTime();
      const result = formatFullDateTime(timestamp, 'UTC');
      expect(result).toContain('January');
    });

    it('should return "Invalid Date" for invalid input', () => {
      expect(formatFullDateTime('not-a-date')).toBe('Invalid Date');
      expect(formatFullDateTime(NaN)).toBe('Invalid Date');
    });
  });

  describe('formatDateOnly', () => {
    it('should format date as YYYY-MM-DD', () => {
      const date = new Date('2025-01-27T12:45:00Z');
      const result = formatDateOnly(date, 'UTC');
      expect(result).toBe('2025-01-27');
    });

    it('should handle string input', () => {
      const result = formatDateOnly('2025-12-31T00:00:00Z', 'UTC');
      expect(result).toBe('2025-12-31');
    });

    it('should return "Invalid Date" for invalid input', () => {
      expect(formatDateOnly('not-a-date')).toBe('Invalid Date');
    });
  });

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-27T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return "just now" for less than 1 minute ago', () => {
      const date = new Date('2025-01-27T11:59:30Z'); // 30 seconds ago
      expect(formatRelativeTime(date)).toBe('just now');
    });

    it('should return minutes ago for less than 1 hour', () => {
      const date = new Date('2025-01-27T11:55:00Z'); // 5 minutes ago
      expect(formatRelativeTime(date)).toBe('5m ago');
    });

    it('should return hours ago for less than 24 hours', () => {
      const date = new Date('2025-01-27T10:00:00Z'); // 2 hours ago
      expect(formatRelativeTime(date)).toBe('2h ago');
    });

    it('should return days ago for less than 7 days', () => {
      const date = new Date('2025-01-24T12:00:00Z'); // 3 days ago
      expect(formatRelativeTime(date)).toBe('3d ago');
    });

    it('should return absolute date for more than 7 days', () => {
      const date = new Date('2025-01-15T12:00:00Z'); // 12 days ago
      const result = formatRelativeTime(date, 'UTC');
      expect(result).toBe('2025-01-15');
    });

    it('should return empty string for invalid date', () => {
      expect(formatRelativeTime('not-a-date')).toBe('');
    });
  });

  describe('formatMemoryTimestamp', () => {
    it('should format as "Mon, Jan 27, 2025"', () => {
      const date = new Date('2025-01-27T12:00:00Z');
      const result = formatMemoryTimestamp(date, 'UTC');
      expect(result).toBe('Mon, Jan 27, 2025');
    });

    it('should handle string input', () => {
      const result = formatMemoryTimestamp('2025-12-25T00:00:00Z', 'UTC');
      expect(result).toBe('Thu, Dec 25, 2025');
    });

    it('should return empty string for invalid date', () => {
      expect(formatMemoryTimestamp('not-a-date')).toBe('');
    });
  });

  describe('formatRelativeTimeDelta', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-27T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return "just now" for less than 1 minute ago', () => {
      const date = new Date('2025-01-27T11:59:30Z'); // 30 seconds ago
      expect(formatRelativeTimeDelta(date)).toBe('just now');
    });

    it('should return "1 minute ago" for exactly 1 minute', () => {
      const date = new Date('2025-01-27T11:59:00Z'); // 1 minute ago
      expect(formatRelativeTimeDelta(date)).toBe('1 minute ago');
    });

    it('should return "X minutes ago" for multiple minutes', () => {
      const date = new Date('2025-01-27T11:45:00Z'); // 15 minutes ago
      expect(formatRelativeTimeDelta(date)).toBe('15 minutes ago');
    });

    it('should return "1 hour ago" for exactly 1 hour', () => {
      const date = new Date('2025-01-27T11:00:00Z'); // 1 hour ago
      expect(formatRelativeTimeDelta(date)).toBe('1 hour ago');
    });

    it('should return "X hours ago" for multiple hours', () => {
      const date = new Date('2025-01-27T07:00:00Z'); // 5 hours ago
      expect(formatRelativeTimeDelta(date)).toBe('5 hours ago');
    });

    it('should return "yesterday" for exactly 1 day ago', () => {
      const date = new Date('2025-01-26T12:00:00Z'); // 1 day ago
      expect(formatRelativeTimeDelta(date)).toBe('yesterday');
    });

    it('should return "X days ago" for 2-6 days', () => {
      const date = new Date('2025-01-24T12:00:00Z'); // 3 days ago
      expect(formatRelativeTimeDelta(date)).toBe('3 days ago');
    });

    it('should return "1 week ago" for exactly 1 week', () => {
      const date = new Date('2025-01-20T12:00:00Z'); // 7 days ago
      expect(formatRelativeTimeDelta(date)).toBe('1 week ago');
    });

    it('should return "X weeks ago" for 2-3 weeks', () => {
      const date = new Date('2025-01-13T12:00:00Z'); // 14 days ago
      expect(formatRelativeTimeDelta(date)).toBe('2 weeks ago');
    });

    it('should return "1 month ago" for approximately 1 month', () => {
      const date = new Date('2024-12-27T12:00:00Z'); // ~31 days ago
      expect(formatRelativeTimeDelta(date)).toBe('1 month ago');
    });

    it('should return "X months ago" for multiple months', () => {
      const date = new Date('2024-10-27T12:00:00Z'); // ~92 days ago
      expect(formatRelativeTimeDelta(date)).toBe('3 months ago');
    });

    it('should return "1 year ago" for approximately 1 year', () => {
      const date = new Date('2024-01-27T12:00:00Z'); // 365 days ago
      expect(formatRelativeTimeDelta(date)).toBe('1 year ago');
    });

    it('should return "X years ago" for multiple years', () => {
      const date = new Date('2023-01-27T12:00:00Z'); // ~730 days ago
      expect(formatRelativeTimeDelta(date)).toBe('2 years ago');
    });

    it('should return "in the future" for future dates', () => {
      const date = new Date('2025-01-28T12:00:00Z'); // tomorrow
      expect(formatRelativeTimeDelta(date)).toBe('in the future');
    });

    it('should return empty string for invalid date', () => {
      expect(formatRelativeTimeDelta('not-a-date')).toBe('');
    });
  });

  describe('formatTimestampWithDelta', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-27T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return both absolute and relative formats', () => {
      const date = new Date('2025-01-13T12:00:00Z'); // 14 days ago
      const result = formatTimestampWithDelta(date, 'UTC');

      expect(result.absolute).toBe('Mon, Jan 13, 2025');
      expect(result.relative).toBe('2 weeks ago');
    });

    it('should handle recent timestamps', () => {
      const date = new Date('2025-01-27T11:55:00Z'); // 5 minutes ago
      const result = formatTimestampWithDelta(date, 'UTC');

      expect(result.absolute).toBe('Mon, Jan 27, 2025');
      expect(result.relative).toBe('5 minutes ago');
    });

    it('should handle old timestamps', () => {
      const date = new Date('2024-01-27T12:00:00Z'); // 1 year ago
      const result = formatTimestampWithDelta(date, 'UTC');

      expect(result.absolute).toBe('Sat, Jan 27, 2024');
      expect(result.relative).toBe('1 year ago');
    });
  });

  describe('formatPromptTimestamp', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-27T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should format recent timestamp with time included', () => {
      const date = new Date('2025-01-27T10:30:00Z'); // 1.5 hours ago
      const result = formatPromptTimestamp(date, 'UTC');

      // Format: "YYYY-MM-DD (Day) HH:MM • relative"
      expect(result).toBe('2025-01-27 (Mon) 10:30 • 1 hour ago');
    });

    it('should format timestamp from earlier today', () => {
      const date = new Date('2025-01-27T08:15:00Z'); // ~4 hours ago
      const result = formatPromptTimestamp(date, 'UTC');

      expect(result).toContain('2025-01-27 (Mon)');
      expect(result).toContain('08:15');
      expect(result).toContain('3 hours ago');
    });

    it('should format timestamp from yesterday', () => {
      const date = new Date('2025-01-26T12:00:00Z'); // 1 day ago
      const result = formatPromptTimestamp(date, 'UTC');

      expect(result).toContain('2025-01-26 (Sun)');
      expect(result).toContain('12:00');
      expect(result).toContain('yesterday');
    });

    it('should format timestamp from a few days ago with time', () => {
      const date = new Date('2025-01-24T12:00:00Z'); // 3 days ago (same time as "now")
      const result = formatPromptTimestamp(date, 'UTC');

      expect(result).toContain('2025-01-24 (Fri)');
      expect(result).toContain('12:00');
      expect(result).toContain('3 days ago');
    });

    it('should format old timestamp without time (>7 days)', () => {
      const date = new Date('2025-01-15T10:30:00Z'); // 12 days ago
      const result = formatPromptTimestamp(date, 'UTC');

      // Older timestamps omit time for brevity
      expect(result).toBe('2025-01-15 (Wed) • 1 week ago');
      expect(result).not.toContain('10:30');
    });

    it('should format very old timestamp without time', () => {
      const date = new Date('2024-10-27T12:00:00Z'); // ~3 months ago
      const result = formatPromptTimestamp(date, 'UTC');

      expect(result).toBe('2024-10-27 (Sun) • 3 months ago');
    });

    it('should return empty string for invalid date', () => {
      expect(formatPromptTimestamp('not-a-date')).toBe('');
      expect(formatPromptTimestamp(NaN)).toBe('');
    });

    it('should handle string input', () => {
      const result = formatPromptTimestamp('2025-01-27T11:00:00Z', 'UTC');

      expect(result).toContain('2025-01-27 (Mon)');
      expect(result).toContain('11:00');
      expect(result).toContain('1 hour ago');
    });

    it('should handle numeric timestamp input', () => {
      const timestamp = new Date('2025-01-27T11:00:00Z').getTime();
      const result = formatPromptTimestamp(timestamp, 'UTC');

      expect(result).toContain('2025-01-27 (Mon)');
      expect(result).toContain('11:00');
    });

    it('should respect timezone parameter', () => {
      // 12:00 UTC = 07:00 EST (America/New_York)
      const date = new Date('2025-01-27T12:00:00Z');
      const result = formatPromptTimestamp(date, 'America/New_York');

      expect(result).toContain('07:00');
    });
  });
});
