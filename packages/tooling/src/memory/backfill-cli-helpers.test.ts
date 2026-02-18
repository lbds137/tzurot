import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDateRange, printDryRunPreview } from './backfill-cli-helpers.js';

describe('backfill-cli-helpers', () => {
  describe('parseDateRange', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    beforeEach(() => {
      mockExit.mockClear();
      mockConsoleError.mockClear();
    });

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

    it('should exit on invalid from date', () => {
      parseDateRange('not-a-date', '2026-02-17');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should exit on invalid to date', () => {
      parseDateRange('2026-02-09', 'garbage');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should exit when from equals to', () => {
      parseDateRange('2026-02-09', '2026-02-09');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should exit when from is after to', () => {
      parseDateRange('2026-02-17', '2026-02-09');
      expect(mockExit).toHaveBeenCalledWith(1);
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
