import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../deployment/railway-api.js', () => ({
  requireRailwayApiToken: vi.fn(),
  redeployRailwayService: vi.fn(),
  listRailwayVariableNames: vi.fn(),
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
  requireRailwayApiToken,
  redeployRailwayService,
  listRailwayVariableNames,
} from '../deployment/railway-api.js';
import { listRailwayServices } from '../deployment/railway-status.js';
import { markSecretRotated } from './rotation.js';
import { UsageError } from '../utils/errors.js';
import {
  resolveRotationContext,
  computeAffectedServices,
  redeployServices,
  reportRedeployFailures,
  stampLedger,
} from './rotate-env-context.js';

const mockRequireToken = vi.mocked(requireRailwayApiToken);
const mockRedeploy = vi.mocked(redeployRailwayService);
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
    mockRedeploy.mockReset().mockResolvedValue(undefined);
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
    it('returns [] when all succeed', async () => {
      const failures = await redeployServices(SERVICES.slice(0, 2), {
        environmentId: 'env-1',
        env: 'dev',
      });

      expect(failures).toEqual([]);
    });

    it('collects the failing service name when one rejects', async () => {
      mockRedeploy.mockImplementation(async args => {
        if (args.serviceId === 'svc-bot') {
          throw new Error('redeploy boom');
        }
      });

      const failures = await redeployServices(SERVICES.slice(0, 2), {
        environmentId: 'env-1',
        env: 'dev',
      });

      expect(failures).toHaveLength(1);
      expect(failures[0].name).toBe('bot-client');
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
    it('names each failed service', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      reportRedeployFailures(
        [{ name: 'bot-client', error: new Error('boom') }],
        'Nothing was written.'
      );

      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).toContain('bot-client');
    });

    it('prints the caller-supplied consequence sentence', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      reportRedeployFailures(
        [{ name: 'bot-client', error: new Error('boom') }],
        'Nothing was written — stage 2 only redeploys presenters.'
      );

      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).toContain('Nothing was written — stage 2 only redeploys presenters.');
      expect(allOutput).not.toContain('mint a THIRD value');
    });
  });
});
