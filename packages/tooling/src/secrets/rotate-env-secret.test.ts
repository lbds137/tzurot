import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../deployment/railway-api.js', () => ({
  requireRailwayApiToken: vi.fn(),
  upsertRailwayVariable: vi.fn(),
  redeployRailwayService: vi.fn(),
  listRailwayVariableNames: vi.fn(),
  readRailwayVariableValue: vi.fn(),
  deleteRailwayVariable: vi.fn(),
}));

vi.mock('../deployment/railway-status.js', () => ({
  listRailwayServices: vi.fn(),
}));

// `./rotation.js` pulls in Prisma at module top — mocking it is mandatory,
// not optional, or this test file can't even load.
vi.mock('./rotation.js', () => ({
  markSecretRotated: vi.fn(),
}));

vi.mock('../utils/confirm.js', () => ({
  confirmPrompt: vi.fn(),
}));

vi.mock('./rotate-env-stages.js', () => ({
  getDualAcceptance: vi.fn(),
  runStagedRotation: vi.fn(),
  // Real alias-table logic, not a real import: keeps this file's other tests
  // (which never touch the resolver) free of network-side-effect risk from
  // whatever `./rotate-env-stages.js` pulls in, while still letting the
  // routing tests exercise real stage-string behavior instead of a fixed
  // stub. Mirrors the alias table in `./rotate-env-stages.ts`.
  resolveStageAlias: vi.fn((rawStage: string) => {
    const aliases: Record<string, 1 | 2 | 3> = {
      '1': 1,
      stage: 1,
      '2': 2,
      roll: 2,
      '3': 3,
      finalize: 3,
    };
    const trimmed = rawStage.trim();
    return Object.hasOwn(aliases, trimmed) ? aliases[trimmed] : undefined;
  }),
}));

import {
  requireRailwayApiToken,
  upsertRailwayVariable,
  redeployRailwayService,
  listRailwayVariableNames,
} from '../deployment/railway-api.js';
import { listRailwayServices } from '../deployment/railway-status.js';
import { UsageError } from '../utils/errors.js';
import { markSecretRotated } from './rotation.js';
import { confirmPrompt } from '../utils/confirm.js';
import { getDualAcceptance, runStagedRotation, resolveStageAlias } from './rotate-env-stages.js';
import { runRotateEnvSecret, type RotateEnvSecretOptions } from './rotate-env-secret.js';

const mockRequireToken = vi.mocked(requireRailwayApiToken);
const mockUpsert = vi.mocked(upsertRailwayVariable);
const mockRedeploy = vi.mocked(redeployRailwayService);
const mockListNames = vi.mocked(listRailwayVariableNames);
const mockListServices = vi.mocked(listRailwayServices);
const mockMarkRotated = vi.mocked(markSecretRotated);
const mockConfirm = vi.mocked(confirmPrompt);
const mockGetDualAcceptance = vi.mocked(getDualAcceptance);
const mockRunStagedRotation = vi.mocked(runStagedRotation);
const mockResolveStageAlias = vi.mocked(resolveStageAlias);

// A single-shot fixture name deliberately OUTSIDE the dual-acceptance
// registry (`INTERNAL_SERVICE_SECRET` is registered and now routes through
// the staged flow) — this is the honest fixture for the single-shot path.
const VAR_NAME = 'SOME_SHARED_SECRET';

const SERVICES = [
  { id: 'svc-gateway', name: 'api-gateway' },
  { id: 'svc-bot', name: 'bot-client' },
  { id: 'svc-ai', name: 'ai-worker' },
  // Non-inheriting: present in the project, does not carry the variable.
  { id: 'svc-redis', name: 'Redis' },
];
const INHERITING_IDS = new Set(['svc-gateway', 'svc-bot', 'svc-ai']);

const BASE_OPTIONS: RotateEnvSecretOptions = {
  env: 'dev',
  name: VAR_NAME,
  dryRun: false,
  yes: true,
};

describe('runRotateEnvSecret', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRequireToken.mockReset();
    mockUpsert.mockReset();
    mockRedeploy.mockReset();
    mockListNames.mockReset();
    mockListServices.mockReset();
    mockMarkRotated.mockReset();
    mockConfirm.mockReset();
    mockGetDualAcceptance.mockReset();
    mockRunStagedRotation.mockReset();
    // mockClear, not mockReset: this mock carries a real-alias-table
    // implementation set in the vi.mock factory above, and mockReset would
    // wipe it back to a no-op, breaking every test that reaches it via a
    // valid --stage. Only the call history needs clearing between tests.
    mockResolveStageAlias.mockClear();

    // The single-shot fixtures in this file rotate a name with no dual
    // acceptance; only the routing-specific tests below override this.
    mockGetDualAcceptance.mockReturnValue(undefined);

    mockRequireToken.mockReturnValue('tok-SENTINEL-do-not-leak');
    mockListServices.mockReturnValue({
      projectId: 'proj-1',
      environmentId: 'env-1',
      services: SERVICES,
    });
    mockListNames.mockImplementation(async args => {
      if (args.serviceId === undefined) {
        return [VAR_NAME, 'OTHER_SHARED_VAR'];
      }
      return INHERITING_IDS.has(args.serviceId) ? [VAR_NAME] : ['REDIS_URL'];
    });
    mockUpsert.mockResolvedValue(undefined);
    mockRedeploy.mockResolvedValue(undefined);
    mockMarkRotated.mockResolvedValue(undefined);
    mockConfirm.mockResolvedValue(true);

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('only inheritors are redeployed', async () => {
    await runRotateEnvSecret(BASE_OPTIONS);

    expect(mockRedeploy).toHaveBeenCalledTimes(3);
    expect(mockRedeploy).toHaveBeenCalledWith({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      env: 'dev',
    });
    expect(mockRedeploy).toHaveBeenCalledWith({
      environmentId: 'env-1',
      serviceId: 'svc-bot',
      env: 'dev',
    });
    expect(mockRedeploy).toHaveBeenCalledWith({
      environmentId: 'env-1',
      serviceId: 'svc-ai',
      env: 'dev',
    });
    for (const call of mockRedeploy.mock.calls) {
      expect(call[0].serviceId).not.toBe('svc-redis');
    }
  });

  it('upserts the shared tier with skipDeploys and the raw --name', async () => {
    await runRotateEnvSecret(BASE_OPTIONS);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const args = mockUpsert.mock.calls[0][0];
    expect(Object.hasOwn(args, 'serviceId')).toBe(false);
    expect(args.skipDeploys).toBe(true);
    expect(args.name).toBe(VAR_NAME);
  });

  it('continues past a failing redeploy and reports it', async () => {
    mockRedeploy.mockImplementation(async args => {
      if (args.serviceId === 'svc-gateway') {
        throw new Error('redeploy boom');
      }
    });

    await expect(runRotateEnvSecret(BASE_OPTIONS)).rejects.toThrow('api-gateway');

    expect(mockRedeploy).toHaveBeenCalledTimes(3);
    expect(mockMarkRotated).toHaveBeenCalledTimes(1);

    const allOutput = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map(String)
      .join('\n');
    expect(allOutput).toContain('api-gateway');
    expect(allOutput).toContain('do NOT re-run');
  });

  it('collects and names ALL failures when multiple redeploys fail', async () => {
    mockRedeploy.mockImplementation(async args => {
      if (args.serviceId === 'svc-gateway') {
        throw new Error('gateway boom');
      }
      if (args.serviceId === 'svc-ai') {
        throw new Error('ai boom');
      }
    });

    await expect(runRotateEnvSecret(BASE_OPTIONS)).rejects.toThrow(
      /2 service\(s\) failed to redeploy: api-gateway, ai-worker/
    );

    // All three inheritors were attempted — the loop did not stop at the first failure.
    expect(mockRedeploy).toHaveBeenCalledTimes(3);
    expect(mockRedeploy).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 'svc-bot' }));

    const allOutput = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map(String)
      .join('\n');
    expect(allOutput).toContain('api-gateway');
    expect(allOutput).toContain('ai-worker');
    expect(allOutput).toMatch(/2 service\(s\) failed/);
  });

  it('names the service when listing its variables fails while computing affected services', async () => {
    mockListNames.mockImplementation(async args => {
      if (args.serviceId === undefined) {
        return [VAR_NAME, 'OTHER_SHARED_VAR'];
      }
      if (args.serviceId === 'svc-bot') {
        throw new Error('boom');
      }
      return INHERITING_IDS.has(args.serviceId) ? [VAR_NAME] : ['REDIS_URL'];
    });

    await expect(runRotateEnvSecret(BASE_OPTIONS)).rejects.toThrow('bot-client');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('does not print the unqualified success marker when a redeploy fails', async () => {
    mockRedeploy.mockImplementation(async args => {
      if (args.serviceId === 'svc-gateway') {
        throw new Error('redeploy boom');
      }
    });

    await expect(runRotateEnvSecret(BASE_OPTIONS)).rejects.toThrow('api-gateway');

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).not.toMatch(/✓ Rotated/);
    expect(allOutput).toMatch(new RegExp(`Rotated "${VAR_NAME}".*but 1 service\\(s\\) failed`));
  });

  it('the generated value never reaches stdout', async () => {
    await runRotateEnvSecret(BASE_OPTIONS);

    const value = mockUpsert.mock.calls[0][0].value;
    expect(value).toMatch(/^[0-9a-f]{64}$/);

    const allOutput = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map(String);
    for (const arg of allOutput) {
      expect(arg).not.toMatch(/[0-9a-f]{64}/);
    }
  });

  it.each([
    { dryRun: false, label: 'real run' },
    { dryRun: true, label: 'dry run' },
  ])('--yes is refused on prod ($label)', async ({ dryRun }) => {
    await expect(
      runRotateEnvSecret({ ...BASE_OPTIONS, env: 'prod', yes: true, dryRun })
    ).rejects.toThrow(/--yes is refused on prod/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('refuses a real run when no service inherits the name', async () => {
    mockListNames.mockImplementation(async args => {
      if (args.serviceId === undefined) {
        return [VAR_NAME];
      }
      return [];
    });

    await expect(runRotateEnvSecret(BASE_OPTIONS)).rejects.toBeInstanceOf(UsageError);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();
  });

  // Ordering is deliberate: guardEmptyAffectedServices runs BEFORE the
  // prod-`--yes` refusal, so an empty affected set wins over the prod-`--yes`
  // UsageError even when both conditions hold at once. The empty-set warning
  // is the more informative refusal, so this pins the property rather than
  // letting a future edit "fix" the order.
  it.each([
    { dryRun: true, label: 'dry run' },
    { dryRun: false, label: 'real run' },
  ])(
    'the empty-affected-set warning wins over the prod --yes refusal ($label)',
    async ({ dryRun }) => {
      mockListNames.mockImplementation(async args => {
        if (args.serviceId === undefined) {
          return [VAR_NAME];
        }
        return [];
      });

      if (dryRun) {
        await expect(
          runRotateEnvSecret({ ...BASE_OPTIONS, env: 'prod', yes: true, dryRun })
        ).resolves.toBeUndefined();

        const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
        expect(allOutput).toContain(VAR_NAME);
        expect(allOutput).toMatch(/warn|REFUSE|⚠️/i);
      } else {
        const promise = runRotateEnvSecret({ ...BASE_OPTIONS, env: 'prod', yes: true, dryRun });
        await expect(promise).rejects.toThrow(/inherits/);
        await expect(promise).rejects.not.toThrow(/refused on prod/);
      }

      expect(mockUpsert).not.toHaveBeenCalled();
    }
  );

  it('--dry-run warns instead of throwing when no service inherits the name', async () => {
    mockListNames.mockImplementation(async args => {
      if (args.serviceId === undefined) {
        return [VAR_NAME];
      }
      return [];
    });

    await expect(runRotateEnvSecret({ ...BASE_OPTIONS, dryRun: true })).resolves.toBeUndefined();

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toContain(VAR_NAME);
    expect(allOutput).toMatch(/warn|REFUSE|⚠️/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('the declined confirmation path mutates nothing', async () => {
    mockConfirm.mockResolvedValue(false);

    await runRotateEnvSecret({ ...BASE_OPTIONS, yes: false });

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toContain('Aborted.');
  });

  it('--yes on dev proceeds without calling confirmPrompt (positive control)', async () => {
    await runRotateEnvSecret({ ...BASE_OPTIONS, env: 'dev', yes: true });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('derives the ledger name as the kebab-case form of --name', async () => {
    await runRotateEnvSecret(BASE_OPTIONS);

    expect(mockMarkRotated).toHaveBeenCalledWith({ env: 'dev', name: 'some-shared-secret' });
  });

  it('a --name absent from the shared tier rejects with UsageError', async () => {
    mockListNames.mockImplementation(async args => {
      if (args.serviceId === undefined) {
        return ['SOME_OTHER_VAR'];
      }
      return [];
    });

    await expect(runRotateEnvSecret(BASE_OPTIONS)).rejects.toBeInstanceOf(UsageError);
    await expect(runRotateEnvSecret(BASE_OPTIONS)).rejects.toThrow(/rotate/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('--dry-run mutates nothing and prints the plan', async () => {
    await runRotateEnvSecret({ ...BASE_OPTIONS, dryRun: true });

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toContain('DRY RUN');
  });

  it('a ledger failure after a successful rotation is reported, not rethrown', async () => {
    mockMarkRotated.mockRejectedValue(new Error('db unreachable'));

    await expect(runRotateEnvSecret(BASE_OPTIONS)).resolves.toBeUndefined();

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toContain('pnpm ops secrets:mark-rotated some-shared-secret --env dev');
  });

  it('a missing token fails before any network call', async () => {
    mockRequireToken.mockImplementation(() => {
      throw new Error('missing token');
    });

    await expect(runRotateEnvSecret(BASE_OPTIONS)).rejects.toThrow('missing token');
    expect(mockListServices).not.toHaveBeenCalled();
  });

  it('a registry name without --stage is a usage error naming the three stages', async () => {
    mockGetDualAcceptance.mockReturnValue({ verifierService: 'api-gateway' });

    await expect(
      runRotateEnvSecret({ ...BASE_OPTIONS, name: 'INTERNAL_SERVICE_SECRET' })
    ).rejects.toThrow(UsageError);
    await expect(
      runRotateEnvSecret({ ...BASE_OPTIONS, name: 'INTERNAL_SERVICE_SECRET' })
    ).rejects.toThrow(/1\|stage.*2\|roll.*3\|finalize/s);
    expect(mockListServices).not.toHaveBeenCalled();
  });

  it('--stage is refused for a name with no dual acceptance', async () => {
    mockGetDualAcceptance.mockReturnValue(undefined);

    await expect(
      runRotateEnvSecret({ ...BASE_OPTIONS, name: VAR_NAME, stage: '1' })
    ).rejects.toThrow(UsageError);
    await expect(
      runRotateEnvSecret({ ...BASE_OPTIONS, name: VAR_NAME, stage: '1' })
    ).rejects.toThrow(/No verifier accepts/);
    expect(mockListServices).not.toHaveBeenCalled();
  });

  it('a registry name with --stage routes to the staged flow', async () => {
    mockGetDualAcceptance.mockReturnValue({ verifierService: 'api-gateway' });
    mockRunStagedRotation.mockResolvedValue(undefined);
    mockListNames.mockImplementation(async args => {
      if (args.serviceId === undefined) {
        return ['INTERNAL_SERVICE_SECRET', 'OTHER_SHARED_VAR'];
      }
      return INHERITING_IDS.has(args.serviceId) ? ['INTERNAL_SERVICE_SECRET'] : ['REDIS_URL'];
    });

    await runRotateEnvSecret({
      ...BASE_OPTIONS,
      name: 'INTERNAL_SERVICE_SECRET',
      stage: '1',
    });

    expect(mockRunStagedRotation).toHaveBeenCalledTimes(1);
    const [stagedOptions] = mockRunStagedRotation.mock.calls[0];
    expect(stagedOptions.name).toBe('INTERNAL_SERVICE_SECRET');
    expect(stagedOptions.stage).toBe('1');
    expect(stagedOptions.verifierService).toBe('api-gateway');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it.each(['5', 'bogus'])(
    'an unknown --stage %s on a registered name throws before any Railway call',
    async invalidStage => {
      mockGetDualAcceptance.mockReturnValue({ verifierService: 'api-gateway' });

      await expect(
        runRotateEnvSecret({
          ...BASE_OPTIONS,
          name: 'INTERNAL_SERVICE_SECRET',
          stage: invalidStage,
        })
      ).rejects.toThrow(`Unknown stage "${invalidStage}" — use 1|stage, 2|roll, or 3|finalize.`);

      // The seam this test exists to pin: resolving an invalid stage must
      // happen BEFORE `resolveRotationContext`'s Railway calls, not after.
      expect(mockResolveStageAlias).toHaveBeenCalledWith(invalidStage);
      expect(mockListServices).not.toHaveBeenCalled();
      expect(mockListNames).not.toHaveBeenCalled();
      expect(mockRunStagedRotation).not.toHaveBeenCalled();
    }
  );
});
