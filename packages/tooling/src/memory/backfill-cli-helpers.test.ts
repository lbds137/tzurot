import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDateRange, printDryRunPreview } from './backfill-cli-helpers.js';
import { UsageError } from '../utils/errors.js';

describe('backfill-cli-helpers', () => {
  describe('parseDateRange', () => {
    it('should parse valid YYYY-MM-DD dates', () => {
      const result = parseDateRange('2026-02-09', '2026-02-17');
      expect(result.fromDate).toEqual(new Date('2026-02-09'));
      expect(result.toDate).toEqual(new Date('2026-02-17'));
    });

    it('should parse ISO 8601 dates', () => {
      const result = parseDateRange('2026-02-10T12:00:00Z', '2026-02-17T00:00:00Z');
      expect(result.fromDate).toEqual(new Date('2026-02-10T12:00:00Z'));
      expect(result.toDate).toEqual(new Date('2026-02-17T00:00:00Z'));
    });

    // These throw rather than exit so cli.ts's top-level handler renders them
    // as a one-line usage error. The CLASS is load-bearing, not just the
    // message: a bare Error would fall through to the raw stack-trace path.
    it('throws a UsageError on an invalid from date', () => {
      expect(() => parseDateRange('not-a-date', '2026-02-17')).toThrow(UsageError);
      expect(() => parseDateRange('not-a-date', '2026-02-17')).toThrow(
        'Invalid date format. Use YYYY-MM-DD.'
      );
    });

    it('throws a UsageError on an invalid to date', () => {
      expect(() => parseDateRange('2026-02-09', 'garbage')).toThrow(UsageError);
    });

    it('throws a UsageError when from equals to', () => {
      expect(() => parseDateRange('2026-02-09', '2026-02-09')).toThrow(
        '--from must be before --to'
      );
    });

    it('throws a UsageError when from is after to', () => {
      expect(() => parseDateRange('2026-02-17', '2026-02-09')).toThrow(UsageError);
    });
  });

  describe('printDryRunPreview', () => {
    const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    beforeEach(() => {
      mockConsoleLog.mockClear();
    });

    it('should print all entries when fewer than 5', () => {
      const pairs = new Map([
        ['id-1', { content: 'short content' }],
        ['id-2', { content: 'another one' }],
      ]);
      printDryRunPreview(pairs);
      // Header + 2 entries = 3 calls
      expect(mockConsoleLog).toHaveBeenCalledTimes(3);
    });

    it('should truncate after 5 entries', () => {
      const pairs = new Map(
        Array.from({ length: 8 }, (_, i) => [`id-${i}`, { content: `content ${i}` }])
      );
      printDryRunPreview(pairs);
      // Header + 5 entries + "... and 3 more" = 7 calls
      expect(mockConsoleLog).toHaveBeenCalledTimes(7);
    });

    it('should truncate long content at 80 chars', () => {
      const longContent = 'x'.repeat(100);
      const pairs = new Map([['id-1', { content: longContent }]]);
      printDryRunPreview(pairs);
      const lastCall = mockConsoleLog.mock.calls[1][0] as string;
      expect(lastCall).toContain('...');
    });
  });
});
