import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../deployment/railway-api.js', () => ({
  assertRailwayServiceDeploymentReady: vi.fn(),
  upsertRailwayVariable: vi.fn(),
  deleteRailwayVariable: vi.fn(),
  readRailwayVariableValue: vi.fn(),
  listRailwayVariableNames: vi.fn(),
}));

vi.mock('../utils/confirm.js', () => ({
  confirmPrompt: vi.fn(),
}));

vi.mock('./deployed-code-gate.js', () => ({
  checkDeployedCodeAcceptsPrevious: vi.fn(),
}));

vi.mock('./rotate-env-context.js', () => ({
  redeployServices: vi.fn(),
  reportRedeployFailures: vi.fn(),
  stampLedger: vi.fn(),
  assertServicesDeploymentReady: vi.fn(
    async (
      services: { id: string; name: string }[],
      context: { environmentId: string; env: 'dev' | 'prod' }
    ) => {
      const { assertRailwayServiceDeploymentReady } = await import('../deployment/railway-api.js');
      for (const svc of services) {
        await assertRailwayServiceDeploymentReady({
          environmentId: context.environmentId,
          serviceId: svc.id,
          serviceName: svc.name,
          env: context.env,
        });
      }
    }
  ),
}));

import {
  assertRailwayServiceDeploymentReady,
  upsertRailwayVariable,
  deleteRailwayVariable,
  readRailwayVariableValue,
  listRailwayVariableNames,
} from '../deployment/railway-api.js';
import { confirmPrompt } from '../utils/confirm.js';
import { UsageError } from '../utils/errors.js';
import { checkDeployedCodeAcceptsPrevious } from './deployed-code-gate.js';
import {
  redeployServices,
  stampLedger,
  type RotationContext,
  type StagedRotationOptions,
} from './rotate-env-context.js';
import { runStagedRotation } from './rotate-env-stages.js';
import { rollMarkerName } from './rotate-env-window.js';

const mockAssertReady = vi.mocked(assertRailwayServiceDeploymentReady);
const mockUpsert = vi.mocked(upsertRailwayVariable);
const mockDelete = vi.mocked(deleteRailwayVariable);
const mockReadValue = vi.mocked(readRailwayVariableValue);
const mockListNames = vi.mocked(listRailwayVariableNames);
const mockConfirm = vi.mocked(confirmPrompt);
const mockGate = vi.mocked(checkDeployedCodeAcceptsPrevious);
const mockRedeploy = vi.mocked(redeployServices);
const mockMarkRotated = vi.mocked(stampLedger);

const VAR_NAME = 'INTERNAL_SERVICE_SECRET';
const PREVIOUS_NAME = `${VAR_NAME}_PREVIOUS`;
const ROLLED_NAME = rollMarkerName(VAR_NAME);
const SENTINEL_VALUE = 'sentinel-current-value-do-not-log';
const SENTINEL_PREVIOUS_VALUE = 'sentinel-previous-value-do-not-log';
const SENTINEL_VALUE_HASH = crypto.createHash('sha256').update(SENTINEL_VALUE).digest('hex');
const STALE_PRIMARY_HASH = crypto
  .createHash('sha256')
  .update(SENTINEL_PREVIOUS_VALUE)
  .digest('hex');

const SERVICES = [
  { id: 'svc-gateway', name: 'api-gateway' },
  { id: 'svc-bot', name: 'bot-client' },
  { id: 'svc-ai', name: 'ai-worker' },
];

function makeContext(overrides: Partial<RotationContext> = {}): RotationContext {
  return {
    projectId: 'proj-1',
    environmentId: 'env-1',
    railwayEnvName: 'dev',
    sharedNames: [VAR_NAME],
    services: SERVICES,
    affectedServices: SERVICES,
    ...overrides,
  };
}

function makeOptions(overrides: Partial<StagedRotationOptions> = {}): StagedRotationOptions {
  return {
    env: 'dev',
    name: VAR_NAME,
    stage: '3',
    dryRun: false,
    yes: true,
    verifierService: 'api-gateway',
    ...overrides,
  };
}

describe('runStage3 roll-marker and presenter-readiness guards', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockAssertReady.mockReset().mockResolvedValue(undefined);
    mockUpsert.mockReset().mockResolvedValue(undefined);
    mockDelete.mockReset().mockResolvedValue(undefined);
    mockListNames.mockReset().mockResolvedValue([VAR_NAME, PREVIOUS_NAME]);
    mockReadValue.mockReset().mockImplementation(async args => {
      if (args.name === PREVIOUS_NAME) {
        return SENTINEL_PREVIOUS_VALUE;
      }
      if (args.name === ROLLED_NAME) {
        return SENTINEL_VALUE_HASH;
      }
      return SENTINEL_VALUE;
    });
    mockConfirm.mockReset().mockResolvedValue(true);
    mockGate.mockReset().mockResolvedValue({ ok: true, commit: 'abc123' });
    mockRedeploy.mockReset().mockResolvedValue([]);
    mockMarkRotated.mockReset().mockResolvedValue(true);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stage 1 then stage 3 (no roll marker) refuses before any delete, redeploy, or ledger stamp', async () => {
    const store = new Map<string, string>([[VAR_NAME, SENTINEL_PREVIOUS_VALUE]]);
    const verifierSet = new Set<string>([VAR_NAME]);

    mockListNames.mockImplementation(async () => [...verifierSet]);
    mockReadValue.mockImplementation(async args => store.get(args.name));
    mockUpsert.mockImplementation(async args => {
      store.set(args.name, args.value);
      if (args.serviceId !== undefined) {
        verifierSet.add(args.name);
      }
    });

    await runStagedRotation(makeOptions({ stage: '1' }), makeContext());
    mockRedeploy.mockClear();

    const rejection = runStagedRotation(makeOptions({ stage: '3' }), makeContext());
    await expect(rejection).rejects.toThrow(UsageError);
    await expect(rejection).rejects.toThrow(/Stage 2 has not finished/i);
    await expect(rejection).rejects.toThrow(/presenters may still hold the old value/i);
    await expect(rejection).rejects.toThrow(/fail authentication/i);
    await expect(rejection).rejects.toThrow(
      'pnpm ops secrets:rotate-env --env dev --name INTERNAL_SERVICE_SECRET --stage 2'
    );
    await expect(rejection).rejects.toThrow(/Repeating stage 2 is safe while the window is open/i);

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();
  });

  it('refuses when the roll marker hashes a different primary', async () => {
    mockReadValue.mockImplementation(async args => {
      if (args.name === PREVIOUS_NAME) {
        return SENTINEL_PREVIOUS_VALUE;
      }
      if (args.name === ROLLED_NAME) {
        return STALE_PRIMARY_HASH;
      }
      return SENTINEL_VALUE;
    });

    const rejection = runStagedRotation(makeOptions({ stage: '3' }), makeContext());
    await expect(rejection).rejects.toThrow(UsageError);
    await expect(rejection).rejects.toThrow(
      'pnpm ops secrets:rotate-env --env dev --name INTERNAL_SERVICE_SECRET --stage 2'
    );

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();
  });

  it('proceeds when the roll marker matches the current primary, deleting _PREVIOUS before the marker', async () => {
    await runStagedRotation(makeOptions({ stage: '3' }), makeContext());

    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete.mock.calls[0][0]).toEqual({
      projectId: 'proj-1',
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      name: PREVIOUS_NAME,
      env: 'dev',
    });
    expect(mockDelete.mock.calls[1][0]).toEqual({
      projectId: 'proj-1',
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      name: ROLLED_NAME,
      env: 'dev',
    });
    expect(mockRedeploy).toHaveBeenCalledTimes(1);
    expect(mockMarkRotated).toHaveBeenCalledWith('dev', 'internal-service-secret');
  });

  it('dry run with a matching marker includes deleting the marker in the plan', async () => {
    await runStagedRotation(makeOptions({ stage: '3', dryRun: true }), makeContext());

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toContain(`Plan: delete "${PREVIOUS_NAME}" from "api-gateway"'s scope`);
    expect(allOutput).toContain(`Plan: delete "${ROLLED_NAME}" from "api-gateway"'s scope`);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();
  });

  it('dry run with no marker reports refusal and writes nothing', async () => {
    mockReadValue.mockImplementation(async args => {
      if (args.name === PREVIOUS_NAME) {
        return SENTINEL_PREVIOUS_VALUE;
      }
      if (args.name === ROLLED_NAME) {
        return undefined;
      }
      return SENTINEL_VALUE;
    });

    await runStagedRotation(makeOptions({ stage: '3', dryRun: true }), makeContext());

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toContain('A real run would REFUSE');
    expect(allOutput).toContain(
      'pnpm ops secrets:rotate-env --env dev --name INTERNAL_SERVICE_SECRET --stage 2'
    );
    expect(allOutput).toContain('[DRY RUN] No changes made.');
    expect(allOutput).not.toContain('Plan:');
  });

  it('refuses before any delete when a presenter deployment is not SUCCESS', async () => {
    mockAssertReady.mockImplementation(async args => {
      if (args.serviceName === 'bot-client') {
        throw new Error(
          "bot-client's latest deployment is DEPLOYING, not SUCCESS — wait for it to settle (or fix it), then re-run. Nothing was changed."
        );
      }
    });

    await expect(runStagedRotation(makeOptions({ stage: '3' }), makeContext())).rejects.toThrow(
      "bot-client's latest deployment is DEPLOYING, not SUCCESS"
    );

    expect(mockAssertReady).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'api-gateway' })
    );
    expect(mockAssertReady).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'bot-client' })
    );
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();
  });

  it('still redeploys and stamps when the marker delete fails, printing the deploy:var-delete cleanup command', async () => {
    mockDelete
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('marker delete failed'));

    await expect(
      runStagedRotation(makeOptions({ stage: '3' }), makeContext())
    ).resolves.toBeUndefined();

    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete.mock.calls[0][0].name).toBe(PREVIOUS_NAME);
    expect(mockDelete.mock.calls[1][0].name).toBe(ROLLED_NAME);
    expect(mockRedeploy).toHaveBeenCalledTimes(1);
    expect(mockMarkRotated).toHaveBeenCalledWith('dev', 'internal-service-secret');

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toContain(
      `pnpm ops deploy:var-delete --env dev --service api-gateway --name ${ROLLED_NAME} --yes`
    );
  });

  it('refuses when the window is closed, naming deploy:redeploy and secrets:mark-rotated for an interrupted stage 3', async () => {
    mockListNames.mockResolvedValue([VAR_NAME]);

    const error = await runStagedRotation(makeOptions({ stage: '3' }), makeContext()).catch(
      (err: unknown) => err
    );

    expect(error).toBeInstanceOf(UsageError);
    const message = String(error);
    expect(message).toContain('run stage 1 first.');
    expect(message).toContain('pnpm ops deploy:redeploy --env dev --service api-gateway --yes');
    expect(message).toContain('pnpm ops secrets:mark-rotated internal-service-secret --env dev');
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();
  });

  it('dry run with a closed window prints the interrupted-stage-3 recovery note and writes nothing', async () => {
    mockListNames.mockResolvedValue([VAR_NAME]);

    await runStagedRotation(makeOptions({ stage: '3', dryRun: true }), makeContext());

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toContain('A real run would REFUSE.');
    expect(allOutput).toContain('pnpm ops deploy:redeploy --env dev --service api-gateway --yes');
    expect(allOutput).toContain('pnpm ops secrets:mark-rotated internal-service-secret --env dev');
    expect(allOutput).toContain('[DRY RUN] No changes made.');
    expect(allOutput).not.toContain('Plan:');
  });
});
