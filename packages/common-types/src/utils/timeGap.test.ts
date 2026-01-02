/**
 * Time Gap Marker Utility Tests
 */

import { describe, expect, it } from 'vitest';
import {
  shouldShowGap,
  calculateTimeGap,
  formatTimeGap,
  formatTimeGapMarker,
  DEFAULT_TIME_GAP_CONFIG,
} from './timeGap.js';

describe('timeGap', () => {
  describe('shouldShowGap', () => {
    it('returns true for gaps >= 1 hour (default threshold)', () => {
      // Exactly 1 hour
      expect(shouldShowGap(60 * 60 * 1000)).toBe(true);
      // 2 hours
      expect(shouldShowGap(2 * 60 * 60 * 1000)).toBe(true);
      // 1 day
      expect(shouldShowGap(24 * 60 * 60 * 1000)).toBe(true);
    });

    it('returns false for gaps < 1 hour (default threshold)', () => {
      // 59 minutes
      expect(shouldShowGap(59 * 60 * 1000)).toBe(false);
      // 30 minutes
      expect(shouldShowGap(30 * 60 * 1000)).toBe(false);
      // 5 seconds
      expect(shouldShowGap(5000)).toBe(false);
      // 0
      expect(shouldShowGap(0)).toBe(false);
    });

    it('uses custom threshold when provided', () => {
      const config = { minGapMs: 30 * 60 * 1000 }; // 30 minutes
      // 30 minutes - exactly at threshold
      expect(shouldShowGap(30 * 60 * 1000, config)).toBe(true);
      // 29 minutes - below threshold
      expect(shouldShowGap(29 * 60 * 1000, config)).toBe(false);
    });

    it('exports default config with 1 hour threshold', () => {
      expect(DEFAULT_TIME_GAP_CONFIG.minGapMs).toBe(60 * 60 * 1000);
    });
  });

  describe('calculateTimeGap', () => {
    it('calculates gap between Date objects', () => {
      const earlier = new Date('2025-01-01T10:00:00Z');
      const later = new Date('2025-01-01T12:00:00Z');
      expect(calculateTimeGap(earlier, later)).toBe(2 * 60 * 60 * 1000);
    });

    it('calculates gap between ISO strings', () => {
      const earlier = '2025-01-01T10:00:00Z';
      const later = '2025-01-01T12:00:00Z';
      expect(calculateTimeGap(earlier, later)).toBe(2 * 60 * 60 * 1000);
    });

    it('calculates gap between timestamps (ms)', () => {
      const earlier = Date.now();
      const later = earlier + 3600000; // 1 hour later
      expect(calculateTimeGap(earlier, later)).toBe(3600000);
    });

    it('handles mixed input types', () => {
      const date = new Date('2025-01-01T10:00:00Z');
      const isoString = '2025-01-01T12:00:00Z';
      expect(calculateTimeGap(date, isoString)).toBe(2 * 60 * 60 * 1000);
    });

    it('returns absolute value (order does not matter)', () => {
      const earlier = '2025-01-01T10:00:00Z';
      const later = '2025-01-01T12:00:00Z';
      // Normal order
      expect(calculateTimeGap(earlier, later)).toBe(2 * 60 * 60 * 1000);
      // Reversed order
      expect(calculateTimeGap(later, earlier)).toBe(2 * 60 * 60 * 1000);
    });

    it('returns 0 for same timestamps', () => {
      const timestamp = '2025-01-01T10:00:00Z';
      expect(calculateTimeGap(timestamp, timestamp)).toBe(0);
    });
  });

  describe('formatTimeGap', () => {
    describe('single units', () => {
      it('formats minutes', () => {
        expect(formatTimeGap(60 * 1000)).toBe('1 minute');
        expect(formatTimeGap(30 * 60 * 1000)).toBe('30 minutes');
        expect(formatTimeGap(59 * 60 * 1000)).toBe('59 minutes');
      });

      it('formats hours', () => {
        expect(formatTimeGap(60 * 60 * 1000)).toBe('1 hour');
        expect(formatTimeGap(2 * 60 * 60 * 1000)).toBe('2 hours');
        expect(formatTimeGap(23 * 60 * 60 * 1000)).toBe('23 hours');
      });

      it('formats days', () => {
        expect(formatTimeGap(24 * 60 * 60 * 1000)).toBe('1 day');
        expect(formatTimeGap(3 * 24 * 60 * 60 * 1000)).toBe('3 days');
      });

      it('formats weeks', () => {
        expect(formatTimeGap(7 * 24 * 60 * 60 * 1000)).toBe('1 week');
        expect(formatTimeGap(2 * 7 * 24 * 60 * 60 * 1000)).toBe('2 weeks');
      });
    });

    describe('combined units', () => {
      it('formats hours and minutes', () => {
        // 1 hour 30 minutes
        expect(formatTimeGap(90 * 60 * 1000)).toBe('1 hour 30 minutes');
        // 2 hours 15 minutes
        expect(formatTimeGap(135 * 60 * 1000)).toBe('2 hours 15 minutes');
      });

      it('formats days and hours', () => {
        // 1 day 2 hours
        expect(formatTimeGap(26 * 60 * 60 * 1000)).toBe('1 day 2 hours');
        // 3 days 12 hours
        expect(formatTimeGap((3 * 24 + 12) * 60 * 60 * 1000)).toBe('3 days 12 hours');
      });

      it('formats weeks and days', () => {
        // 1 week 2 days
        expect(formatTimeGap((7 + 2) * 24 * 60 * 60 * 1000)).toBe('1 week 2 days');
      });

      it('limits to 2 units for readability', () => {
        // 1 week 2 days 3 hours 4 minutes -> "1 week 2 days" (stops at 2)
        const complexGap = (7 + 2) * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000 + 4 * 60 * 1000;
        expect(formatTimeGap(complexGap)).toBe('1 week 2 days');
      });
    });

    describe('edge cases', () => {
      it('handles less than a minute', () => {
        expect(formatTimeGap(30 * 1000)).toBe('less than a minute');
        expect(formatTimeGap(59 * 1000)).toBe('less than a minute');
        expect(formatTimeGap(0)).toBe('less than a minute');
      });

      it('handles singular vs plural correctly', () => {
        expect(formatTimeGap(1 * 60 * 1000)).toBe('1 minute');
        expect(formatTimeGap(2 * 60 * 1000)).toBe('2 minutes');
        expect(formatTimeGap(1 * 60 * 60 * 1000)).toBe('1 hour');
        expect(formatTimeGap(2 * 60 * 60 * 1000)).toBe('2 hours');
        expect(formatTimeGap(1 * 24 * 60 * 60 * 1000)).toBe('1 day');
        expect(formatTimeGap(2 * 24 * 60 * 60 * 1000)).toBe('2 days');
        expect(formatTimeGap(1 * 7 * 24 * 60 * 60 * 1000)).toBe('1 week');
        expect(formatTimeGap(2 * 7 * 24 * 60 * 60 * 1000)).toBe('2 weeks');
      });
    });
  });

  describe('formatTimeGapMarker', () => {
    it('formats as XML element', () => {
      expect(formatTimeGapMarker(2 * 60 * 60 * 1000)).toBe('<time_gap duration="2 hours" />');
    });

    it('handles combined units', () => {
      expect(formatTimeGapMarker(90 * 60 * 1000)).toBe('<time_gap duration="1 hour 30 minutes" />');
    });

    it('handles days', () => {
      expect(formatTimeGapMarker(24 * 60 * 60 * 1000)).toBe('<time_gap duration="1 day" />');
    });
  });
});
