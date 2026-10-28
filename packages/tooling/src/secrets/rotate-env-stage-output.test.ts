import { describe, it, expect, vi, afterEach } from 'vitest';

import { RailwayRedeployRefusedError } from '../deployment/railway-api.js';
import { UsageError } from '../utils/errors.js';
import {
  printDryRunNotice,
  refuseIfWindowClosed,
  printGateVerdict,
  stage1RedeployFailureError,
  stage2RedeployFailureError,
  stage3RedeployFailureError,
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

  describe('redeploy failure errors', () => {
    it('stage 1 names the verifier, all four terminal states and the dashboard', () => {
      const message = stage1RedeployFailureError('api-gateway').message;

      expect(message).toContain('"api-gateway" shows SUCCESS');
      expect(message).toContain('FAILED, CRASHED, REMOVED or SKIPPED');
      expect(message).toContain('fix "api-gateway" in the Railway dashboard');
      expect(message).not.toContain('by hand');
    });

    it('stage 2 names the count, all four terminal states and the dashboard', () => {
      const message = stage2RedeployFailureError(2).message;

      expect(message).toContain('2 service(s) failed to redeploy');
      expect(message).toContain('FAILED, CRASHED, REMOVED or SKIPPED');
      expect(message).toContain('fixed in the Railway dashboard');
      expect(message).not.toContain('by hand');
    });

    it('stage 3 keeps the by-hand wording for a plain failure', () => {
      const message = stage3RedeployFailureError({
        previousName: PREVIOUS_NAME,
        verifierName: 'api-gateway',
        failures: [{ name: 'api-gateway', error: new Error('boom') }],
        ledgerName: 'internal-service-secret',
        env: 'dev',
      }).message;

      expect(message).toContain(
        'Do NOT re-run this command — redeploy "api-gateway" by hand (Railway dashboard or `pnpm ops deploy:redeploy --env dev --service api-gateway --yes`) and wait for it to reach SUCCESS, then'
      );
      expect(message.indexOf('wait for it to reach SUCCESS')).toBeLessThan(
        message.indexOf('stamp the ledger')
      );
      expect(message).toContain(
        '`pnpm ops secrets:mark-rotated internal-service-secret --env dev`'
      );
    });

    it('stage 3 sends a refused redeploy to the dashboard and keeps the ledger sentence', () => {
      const message = stage3RedeployFailureError({
        previousName: PREVIOUS_NAME,
        verifierName: 'api-gateway',
        failures: [{ name: 'api-gateway', error: new RailwayRedeployRefusedError('BUILDING') }],
        ledgerName: 'internal-service-secret',
        env: 'dev',
      }).message;

      expect(message).toContain('api-gateway: the redeploy was refused');
      expect(message).toContain('Railway dashboard');
      expect(message).not.toContain('by hand');
      expect(message).toContain(
        'fix it in the Railway dashboard, then redeploy it with `pnpm ops deploy:redeploy --env dev --service api-gateway --yes`, wait for it to reach SUCCESS, then stamp'
      );
      expect(message.indexOf('wait for it to reach SUCCESS')).toBeLessThan(
        message.indexOf('stamp the ledger')
      );
      expect(message).toContain(
        '`pnpm ops secrets:mark-rotated internal-service-secret --env dev`'
      );
    });
  });
});
