import { describe, it, expect, vi, afterEach } from 'vitest';

import { UsageError } from '../utils/errors.js';
import {
  printDryRunNotice,
  refuseIfWindowClosed,
  printGateVerdict,
} from './rotate-env-stage-output.js';

const PREVIOUS_NAME = 'INTERNAL_SERVICE_SECRET_PREVIOUS';

describe('rotate-env-stage-output', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('printDryRunNotice', () => {
    it('writes the dry-run notice to stdout', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      printDryRunNotice();

      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).toMatch(/\[DRY RUN\] No changes made\./);
    });
  });

  describe('printGateVerdict', () => {
    it('prints PASS wording including the commit when ok is true', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      printGateVerdict({ ok: true, commit: 'abc123' });

      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).toMatch(/PASS/);
      expect(allOutput).toContain('abc123');
    });

    it('prints REFUSE wording including the reason when ok is false', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      printGateVerdict({ ok: false, commit: 'abc123', reason: 'no token' });

      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).toMatch(/REFUSE/);
      expect(allOutput).toContain('no token');
    });
  });

  describe('refuseIfWindowClosed', () => {
    it('returns false and prints nothing when the window is open', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = refuseIfWindowClosed(true, false, PREVIOUS_NAME);

      expect(result).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('with the window closed and dryRun true, returns true and prints REFUSE without throwing', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = refuseIfWindowClosed(false, true, PREVIOUS_NAME);

      expect(result).toBe(true);
      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).toMatch(/REFUSE/);
    });

    it('with the window closed and dryRun false, throws UsageError naming the previous variable and stage 1', () => {
      expect(() => refuseIfWindowClosed(false, false, PREVIOUS_NAME)).toThrow(UsageError);
      expect(() => refuseIfWindowClosed(false, false, PREVIOUS_NAME)).toThrow(
        new RegExp(`${PREVIOUS_NAME}.*run stage 1`, 's')
      );
    });
  });
});
