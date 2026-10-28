import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../deployment/railway-api.js', () => ({
  assertRailwayServiceDeploymentReady: vi.fn(),
  requireRailwayApiToken: vi.fn(),
  redeployRailwayServiceReusingImage: vi.fn(),
  listRailwayVariableNames: vi.fn(),
  // redeploy-repair-text.ts does `instanceof` against this class on a failure's error.
  RailwayRedeployRefusedError: class RailwayRedeployRefusedError extends Error {
    name = 'RailwayRedeployRefusedError';
  },
}));

vi.mock('../deployment/railway-status.js', () => ({
  listRailwayServices: vi.fn(),
}));

// `./rotation.js` pulls in Prisma at module top — mocking it is mandatory,
// not optional, or this test file can't even load.
vi.mock('./rotation.js', () => ({
  markSecretRotated: vi.fn(),
}));

import {
  assertRailwayServiceDeploymentReady,
  requireRailwayApiToken,
  redeployRailwayServiceReusingImage,
  listRailwayVariableNames,
  RailwayRedeployRefusedError,
} from '../deployment/railway-api.js';
import { listRailwayServices } from '../deployment/railway-status.js';
import { markSecretRotated } from './rotation.js';
import { UsageError } from '../utils/errors.js';
import {
  resolveRotationContext,
  computeAffectedServices,
  assertServicesDeploymentReady,
  redeployServices,
  reportRedeployFailures,
  stampLedger,
} from './rotate-env-context.js';
import {
  STAGE2_NEXT_STEP,
  stage1NextStep,
  stage1RedeployFailureError,
  stage2RedeployFailureError,
} from './rotate-env-stage-output.js';

const mockAssertReady = vi.mocked(assertRailwayServiceDeploymentReady);
const mockRequireToken = vi.mocked(requireRailwayApiToken);
const mockRedeploy = vi.mocked(redeployRailwayServiceReusingImage);
const mockListNames = vi.mocked(listRailwayVariableNames);
const mockListServices = vi.mocked(listRailwayServices);
const mockMarkRotated = vi.mocked(markSecretRotated);

const VAR_NAME = 'SOME_SHARED_SECRET';

const SERVICES = [
  { id: 'svc-gateway', name: 'api-gateway' },
  { id: 'svc-bot', name: 'bot-client' },
  { id: 'svc-ai', name: 'ai-worker' },
  { id: 'svc-redis', name: 'Redis' },
];
const INHERITING_IDS = new Set(['svc-gateway', 'svc-bot', 'svc-ai']);

describe('rotate-env-context', () => {
  beforeEach(() => {
    mockRequireToken.mockReset().mockReturnValue('tok-SENTINEL-do-not-leak');
    mockListServices.mockReset().mockReturnValue({
      projectId: 'proj-1',
      environmentId: 'env-1',
      services: SERVICES,
    });
    mockListNames.mockReset().mockImplementation(async args => {
      if (args.serviceId === undefined) {
        return [VAR_NAME, 'OTHER_SHARED_VAR'];
      }
      return INHERITING_IDS.has(args.serviceId) ? [VAR_NAME] : ['REDIS_URL'];
    });
    mockRedeploy.mockReset().mockResolvedValue('dep-new');
    mockMarkRotated.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('resolveRotationContext', () => {
    it('returns the derived affectedServices, excluding the non-inheriting service', async () => {
      const context = await resolveRotationContext({ env: 'dev', name: VAR_NAME });

      expect(context.affectedServices).toEqual([
        { id: 'svc-gateway', name: 'api-gateway' },
        { id: 'svc-bot', name: 'bot-client' },
        { id: 'svc-ai', name: 'ai-worker' },
      ]);
    });

    it('throws UsageError when the name is not in the shared list', async () => {
      mockListNames.mockImplementation(async args => {
        if (args.serviceId === undefined) {
          return ['SOME_OTHER_VAR'];
        }
        return [];
      });

      await expect(resolveRotationContext({ env: 'dev', name: VAR_NAME })).rejects.toBeInstanceOf(
        UsageError
      );
    });
  });

  describe('computeAffectedServices', () => {
    it('wraps a per-service listing failure with the service name', async () => {
      mockListNames.mockImplementation(async args => {
        if (args.serviceId === 'svc-bot') {
          throw new Error('boom');
        }
        return INHERITING_IDS.has(args.serviceId ?? '') ? [VAR_NAME] : [];
      });

      await expect(
        computeAffectedServices(SERVICES, VAR_NAME, {
          projectId: 'proj-1',
          environmentId: 'env-1',
          env: 'dev',
        })
      ).rejects.toThrow('bot-client');
    });
  });

  describe('redeployServices', () => {
    it('returns [] when all succeed and passes environmentId, serviceId, env', async () => {
      const failures = await redeployServices(SERVICES.slice(0, 2), {
        environmentId: 'env-1',
        env: 'dev',
      });

      expect(failures).toEqual([]);
      expect(mockRedeploy).toHaveBeenCalledTimes(2);
      expect(mockRedeploy).toHaveBeenCalledWith({
        environmentId: 'env-1',
        serviceId: 'svc-gateway',
        serviceName: 'api-gateway',
        env: 'dev',
      });
      expect(mockRedeploy).toHaveBeenCalledWith({
        environmentId: 'env-1',
        serviceId: 'svc-bot',
        serviceName: 'bot-client',
        env: 'dev',
      });
    });

    it('collects the failing service name when one rejects', async () => {
      mockRedeploy.mockImplementation(async args => {
        if (args.serviceId === 'svc-bot') {
          throw new Error('redeploy boom');
        }
        return 'dep-new';
      });

      const failures = await redeployServices(SERVICES.slice(0, 2), {
        environmentId: 'env-1',
        env: 'dev',
      });

      expect(failures).toHaveLength(1);
      expect(failures[0].name).toBe('bot-client');
    });
  });

  describe('assertServicesDeploymentReady', () => {
    it('checks each service with exactly environmentId, serviceId, serviceName, env, in order', async () => {
      await assertServicesDeploymentReady(SERVICES.slice(0, 2), {
        environmentId: 'env-1',
        env: 'dev',
      });

      expect(mockAssertReady).toHaveBeenCalledTimes(2);
      expect(mockAssertReady).toHaveBeenNthCalledWith(1, {
        environmentId: 'env-1',
        serviceId: 'svc-gateway',
        serviceName: 'api-gateway',
        env: 'dev',
      });
      expect(mockAssertReady).toHaveBeenNthCalledWith(2, {
        environmentId: 'env-1',
        serviceId: 'svc-bot',
        serviceName: 'bot-client',
        env: 'dev',
      });
    });

    it('stops at the first rejection — the second service is not checked', async () => {
      mockAssertReady.mockReset().mockRejectedValueOnce(new Error('not ready'));

      await expect(
        assertServicesDeploymentReady(SERVICES.slice(0, 2), {
          environmentId: 'env-1',
          env: 'dev',
        })
      ).rejects.toThrow('not ready');

      expect(mockAssertReady).toHaveBeenCalledTimes(1);
    });
  });

  describe('stampLedger', () => {
    it('returns false and prints the manual-command hint when markSecretRotated rejects', async () => {
      mockMarkRotated.mockRejectedValue(new Error('db unreachable'));
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await stampLedger('dev', 'internal-service-secret');

      expect(result).toBe(false);
      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).toContain(
        'pnpm ops secrets:mark-rotated internal-service-secret --env dev'
      );
    });
  });

  describe('reportRedeployFailures', () => {
    it('names each failed service and prints the deploy:redeploy repair command', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      reportRedeployFailures(
        [{ name: 'bot-client', error: new Error('boom') }],
        'Nothing was written.',
        'prod'
      );

      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).toContain('bot-client');
      expect(allOutput).toContain('pnpm ops deploy:redeploy --env prod --service bot-client --yes');
      expect(allOutput).not.toContain('railway redeploy');
    });

    it('sends a refused redeploy to the dashboard and lists the command only for the other failures', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logSpy.mockClear();

      reportRedeployFailures(
        [
          { name: 'bot-client', error: new RailwayRedeployRefusedError('not SUCCESS') },
          { name: 'ai-worker', error: new Error('boom') },
        ],
        'Nothing was written.',
        'prod'
      );

      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).toContain(
        'bot-client: the redeploy was refused because the latest deployment is not SUCCESS — wait for it to settle, or fix it in the Railway dashboard, then redeploy'
      );
      expect(allOutput).toContain(
        'Nothing was written. bot-client: the redeploy was refused because the latest deployment is not SUCCESS — wait for it to settle, or fix it in the Railway dashboard, then redeploy it with `pnpm ops deploy:redeploy --env prod --service bot-client --yes`, wait for it to reach SUCCESS; for the rest: repair the lagging service(s) from the Railway dashboard or `pnpm ops deploy:redeploy --env prod --service ai-worker --yes` — do NOT re-run this command.'
      );
    });

    it('prints the dashboard repair with the command only as the retry when every failure was refused', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logSpy.mockClear();

      reportRedeployFailures(
        [{ name: 'bot-client', error: new RailwayRedeployRefusedError('not SUCCESS') }],
        'Nothing was written.',
        'prod'
      );

      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).toContain(
        'Nothing was written. bot-client: the redeploy was refused because the latest deployment is not SUCCESS — wait for it to settle, or fix it in the Railway dashboard, then redeploy it with `pnpm ops deploy:redeploy --env prod --service bot-client --yes`, wait for it to reach SUCCESS — do NOT re-run this command.'
      );
    });

    it('prints the caller-supplied consequence sentence', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      reportRedeployFailures(
        [{ name: 'bot-client', error: new Error('boom') }],
        'Nothing was written.',
        'dev'
      );

      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).toContain('Nothing was written.');
      expect(allOutput).not.toContain('mint a THIRD value');
    });

    it('with a closing, prints "<consequence> <closing>" exactly, with no composed repair and no re-run suffix', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logSpy.mockClear();

      reportRedeployFailures(
        [{ name: 'bot-client', error: new RailwayRedeployRefusedError('not SUCCESS') }],
        'Nothing was written.',
        'prod',
        'Re-run stage 2 once bot-client shows SUCCESS.'
      );

      const lines = logSpy.mock.calls.flat().map(String);
      expect(lines.at(-1)).toContain(
        '\nNothing was written. Re-run stage 2 once bot-client shows SUCCESS.'
      );
      expect(lines.at(-1)?.endsWith('Re-run stage 2 once bot-client shows SUCCESS.')).toBe(true);
      expect(lines.join('\n')).not.toContain('do NOT re-run this command');
      expect(lines.join('\n')).not.toContain('deploy:redeploy');
    });

    it('without a closing, the output is unchanged: composed repair plus the re-run suffix', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logSpy.mockClear();

      reportRedeployFailures(
        [{ name: 'bot-client', error: new Error('boom') }],
        'Nothing was written.',
        'prod'
      );

      const lines = logSpy.mock.calls.flat().map(String);
      expect(lines.at(-1)).toContain(
        'Nothing was written. Repair the lagging service(s) from the Railway dashboard or `pnpm ops deploy:redeploy --env prod --service bot-client --yes` — do NOT re-run this command.'
      );
    });

    it.each([
      ['stage 1', stage1NextStep('api-gateway'), stage1RedeployFailureError('api-gateway').message],
      ['stage 2', STAGE2_NEXT_STEP, stage2RedeployFailureError(1).message],
    ])(
      '%s: the printed report and the thrown error give the same next step and never say "re-run this command"',
      (_stage, closing, thrown) => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        logSpy.mockClear();

        reportRedeployFailures(
          [{ name: 'api-gateway', error: new RailwayRedeployRefusedError('not SUCCESS') }],
          'The new primary is live.',
          'dev',
          closing
        );

        const printed = logSpy.mock.calls.flat().map(String).join('\n');
        expect(printed).not.toMatch(/re-run this command/i);
        expect(thrown).not.toMatch(/re-run this command/i);
        expect(printed).not.toContain('deploy:redeploy --');
        expect(printed).toContain(closing);
        expect(thrown).toContain(closing);
      }
    );
  });
});
