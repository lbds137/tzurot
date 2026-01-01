/**
 * Duration Utility Tests
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Duration, DurationParseError } from './Duration.js';

describe('Duration', () => {
  describe('parse', () => {
    describe('time units', () => {
      it('parses minutes', () => {
        expect(Duration.parse('30m').toSeconds()).toBe(30 * 60);
        expect(Duration.parse('30min').toSeconds()).toBe(30 * 60);
        expect(Duration.parse('30 minutes').toSeconds()).toBe(30 * 60);
        expect(Duration.parse('1 minute').toSeconds()).toBe(60);
      });

      it('parses hours', () => {
        expect(Duration.parse('2h').toSeconds()).toBe(2 * 60 * 60);
        expect(Duration.parse('2hr').toSeconds()).toBe(2 * 60 * 60);
        expect(Duration.parse('2 hours').toSeconds()).toBe(2 * 60 * 60);
        expect(Duration.parse('1 hour').toSeconds()).toBe(60 * 60);
      });

      it('parses days', () => {
        expect(Duration.parse('1d').toSeconds()).toBe(24 * 60 * 60);
        expect(Duration.parse('1 day').toSeconds()).toBe(24 * 60 * 60);
        expect(Duration.parse('3 days').toSeconds()).toBe(3 * 24 * 60 * 60);
      });

      it('parses weeks', () => {
        expect(Duration.parse('1w').toSeconds()).toBe(7 * 24 * 60 * 60);
        expect(Duration.parse('1 week').toSeconds()).toBe(7 * 24 * 60 * 60);
        expect(Duration.parse('2 weeks').toSeconds()).toBe(2 * 7 * 24 * 60 * 60);
      });

      it('parses seconds', () => {
        expect(Duration.parse('45s').toSeconds()).toBe(45);
        expect(Duration.parse('45 seconds').toSeconds()).toBe(45);
      });

      it('handles case insensitivity', () => {
        expect(Duration.parse('2H').toSeconds()).toBe(2 * 60 * 60);
        expect(Duration.parse('30M').toSeconds()).toBe(30 * 60);
        expect(Duration.parse('1D').toSeconds()).toBe(24 * 60 * 60);
      });

      it('handles whitespace', () => {
        expect(Duration.parse('  2h  ').toSeconds()).toBe(2 * 60 * 60);
        expect(Duration.parse('30 m').toSeconds()).toBe(30 * 60);
      });
    });

    describe('disabled state', () => {
      it('parses "off"', () => {
        const d = Duration.parse('off');
        expect(d.isEnabled).toBe(false);
        expect(d.toSeconds()).toBeNull();
      });

      it('parses "disable"', () => {
        expect(Duration.parse('disable').isEnabled).toBe(false);
      });

      it('parses "disabled"', () => {
        expect(Duration.parse('disabled').isEnabled).toBe(false);
      });

      it('parses "none"', () => {
        expect(Duration.parse('none').isEnabled).toBe(false);
      });

      it('parses "null"', () => {
        expect(Duration.parse('null').isEnabled).toBe(false);
      });

      it('parses "0"', () => {
        expect(Duration.parse('0').isEnabled).toBe(false);
      });

      it('handles null input', () => {
        expect(Duration.parse(null).isEnabled).toBe(false);
      });

      it('handles undefined input', () => {
        expect(Duration.parse(undefined).isEnabled).toBe(false);
      });
    });

    describe('error handling', () => {
      it('throws on completely invalid input', () => {
        // parse-duration returns null for strings with no numeric content
        expect(() => Duration.parse('invalid')).toThrow(DurationParseError);
        expect(() => Duration.parse('abc')).toThrow(DurationParseError);
      });

      it('throws on negative duration', () => {
        expect(() => Duration.parse('-5m')).toThrow(DurationParseError);
      });

      it('throws on empty string', () => {
        expect(() => Duration.parse('')).toThrow(DurationParseError);
      });

      it('accepts numbers with text (parse-duration extracts the number)', () => {
        // parse-duration extracts numbers: "abc123" -> 123ms -> 0 seconds (floored)
        // This actually becomes 0 seconds which is <= 0, so it should throw
        // But "30abc" would be parsed as 30ms
        // This is expected behavior from parse-duration library
        expect(() => Duration.parse('abc123')).toThrow(DurationParseError); // 123ms = 0 seconds
      });
    });
  });

  describe('factory methods', () => {
    it('fromDb creates from seconds', () => {
      const d = Duration.fromDb(3600);
      expect(d.toSeconds()).toBe(3600);
      expect(d.isEnabled).toBe(true);
    });

    it('fromDb handles null', () => {
      const d = Duration.fromDb(null);
      expect(d.isEnabled).toBe(false);
      expect(d.toSeconds()).toBeNull();
    });

    it('disabled creates disabled duration', () => {
      const d = Duration.disabled();
      expect(d.isEnabled).toBe(false);
      expect(d.toSeconds()).toBeNull();
    });

    it('fromSeconds creates from seconds', () => {
      const d = Duration.fromSeconds(7200);
      expect(d.toSeconds()).toBe(7200);
      expect(d.isEnabled).toBe(true);
    });

    it('fromSeconds throws on non-positive', () => {
      expect(() => Duration.fromSeconds(0)).toThrow(DurationParseError);
      expect(() => Duration.fromSeconds(-1)).toThrow(DurationParseError);
    });
  });

  describe('output methods', () => {
    describe('toHuman', () => {
      it('formats weeks', () => {
        expect(Duration.parse('1w').toHuman()).toBe('1 week');
        expect(Duration.parse('2w').toHuman()).toBe('2 weeks');
      });

      it('formats days', () => {
        expect(Duration.parse('1d').toHuman()).toBe('1 day');
        expect(Duration.parse('3d').toHuman()).toBe('3 days');
      });

      it('formats hours', () => {
        expect(Duration.parse('1h').toHuman()).toBe('1 hour');
        expect(Duration.parse('2h').toHuman()).toBe('2 hours');
      });

      it('formats minutes', () => {
        expect(Duration.parse('1m').toHuman()).toBe('1 minute');
        expect(Duration.parse('30m').toHuman()).toBe('30 minutes');
      });

      it('formats seconds', () => {
        expect(Duration.parse('1s').toHuman()).toBe('1 second');
        expect(Duration.parse('45s').toHuman()).toBe('45 seconds');
      });

      it('formats disabled', () => {
        expect(Duration.parse('off').toHuman()).toBe('Disabled');
        expect(Duration.disabled().toHuman()).toBe('Disabled');
      });

      it('uses largest clean unit', () => {
        // 90 minutes = 1.5 hours, should show as "90 minutes" not "1 hour"
        // because it doesn't divide evenly into hours
        expect(Duration.fromDb(90 * 60).toHuman()).toBe('90 minutes');
      });
    });

    describe('toCompact', () => {
      it('formats weeks', () => {
        expect(Duration.parse('1w').toCompact()).toBe('1w');
        expect(Duration.parse('2w').toCompact()).toBe('2w');
      });

      it('formats days', () => {
        expect(Duration.parse('1d').toCompact()).toBe('1d');
        expect(Duration.parse('3d').toCompact()).toBe('3d');
      });

      it('formats hours', () => {
        expect(Duration.parse('1h').toCompact()).toBe('1h');
        expect(Duration.parse('24h').toCompact()).toBe('1d');
      });

      it('formats minutes', () => {
        expect(Duration.parse('30m').toCompact()).toBe('30m');
        expect(Duration.parse('60m').toCompact()).toBe('1h');
      });

      it('formats seconds', () => {
        expect(Duration.parse('45s').toCompact()).toBe('45s');
      });

      it('formats disabled', () => {
        expect(Duration.parse('off').toCompact()).toBe('off');
      });
    });

    describe('toMs', () => {
      it('converts to milliseconds', () => {
        expect(Duration.parse('1s').toMs()).toBe(1000);
        expect(Duration.parse('1m').toMs()).toBe(60000);
      });

      it('returns null when disabled', () => {
        expect(Duration.parse('off').toMs()).toBeNull();
      });
    });

    describe('toDb', () => {
      it('returns seconds', () => {
        expect(Duration.parse('2h').toDb()).toBe(7200);
      });

      it('returns null when disabled', () => {
        expect(Duration.parse('off').toDb()).toBeNull();
      });
    });
  });

  describe('query helpers', () => {
    describe('getCutoffDate', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('returns date in the past', () => {
        const d = Duration.parse('2h');
        const cutoff = d.getCutoffDate();
        expect(cutoff).toBeInstanceOf(Date);
        expect(cutoff!.toISOString()).toBe('2026-01-01T10:00:00.000Z');
      });

      it('returns null when disabled', () => {
        expect(Duration.parse('off').getCutoffDate()).toBeNull();
      });
    });

    describe('isWithinWindow', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('returns true for recent dates', () => {
        const d = Duration.parse('2h');
        const recentDate = new Date('2026-01-01T11:00:00.000Z'); // 1 hour ago
        expect(d.isWithinWindow(recentDate)).toBe(true);
      });

      it('returns false for old dates', () => {
        const d = Duration.parse('2h');
        const oldDate = new Date('2026-01-01T08:00:00.000Z'); // 4 hours ago
        expect(d.isWithinWindow(oldDate)).toBe(false);
      });

      it('returns true for exact cutoff', () => {
        const d = Duration.parse('2h');
        const cutoffDate = new Date('2026-01-01T10:00:00.000Z'); // exactly 2 hours ago
        expect(d.isWithinWindow(cutoffDate)).toBe(true);
      });

      it('returns true when disabled (no filtering)', () => {
        const d = Duration.parse('off');
        const veryOldDate = new Date('2020-01-01T00:00:00.000Z');
        expect(d.isWithinWindow(veryOldDate)).toBe(true);
      });
    });
  });

  describe('validation', () => {
    it('validates minimum bound', () => {
      const d = Duration.parse('1m');
      const result = d.validate({ min: 5 * 60 }); // 5 minutes min
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least 5 minutes');
    });

    it('validates maximum bound', () => {
      const d = Duration.parse('1w');
      const result = d.validate({ max: 24 * 60 * 60 }); // 1 day max
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot exceed 1 day');
    });

    it('passes within bounds', () => {
      const d = Duration.parse('2h');
      const result = d.validate({ min: 60 * 60, max: 24 * 60 * 60 });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('allows disabled regardless of bounds', () => {
      const d = Duration.parse('off');
      const result = d.validate({ min: 5 * 60 });
      expect(result.valid).toBe(true);
    });

    it('validates both bounds', () => {
      const d = Duration.parse('10m');
      expect(d.validate({ min: 5 * 60, max: 60 * 60 }).valid).toBe(true);
    });
  });
});
