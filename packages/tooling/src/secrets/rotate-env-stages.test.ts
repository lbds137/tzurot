import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../deployment/railway-api.js', () => ({
  assertRailwayServiceDeploymentReady: vi.fn(),
  getRailwayServiceLatestDeployment: vi.fn(),
  redeployRailwayServiceReusingImageWithSource: vi.fn(),
  upsertRailwayVariable: vi.fn(),
  deleteRailwayVariable: vi.fn(),
  readRailwayVariableValue: vi.fn(),
  listRailwayVariableNames: vi.fn(),
  // The real wait and redeploy-repair-text.ts do `instanceof` against this class.
  RailwayRedeployRefusedError: class RailwayRedeployRefusedError extends Error {
    name = 'RailwayRedeployRefusedError';
  },
}));

vi.mock('../utils/confirm.js', () => ({
  confirmPrompt: vi.fn(),
}));

vi.mock('./deployed-code-gate.js', () => ({
  checkDeployedCodeAcceptsPrevious: vi.fn(),
}));

// The readiness helper is a pass-through mirroring the real helper's loop: the
// seam these tests pin — assertRailwayServiceDeploymentReady's args and
// ordering — stays at the (mocked) railway-api layer, so the preflight-refusal
// tests keep their teeth. importOriginal would drag the real module's
// rotation.js (Prisma) into this file's graph.
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
  getRailwayServiceLatestDeployment,
  redeployRailwayServiceReusingImageWithSource,
  upsertRailwayVariable,
  deleteRailwayVariable,
  readRailwayVariableValue,
  listRailwayVariableNames,
  RailwayRedeployRefusedError,
} from '../deployment/railway-api.js';
import { confirmPrompt } from '../utils/confirm.js';
import { checkDeployedCodeAcceptsPrevious } from './deployed-code-gate.js';
import {
  redeployServices,
  reportRedeployFailures,
  stampLedger,
  type RotationContext,
} from './rotate-env-context.js';
import { STAGE2_NEXT_STEP, stage1NextStep, stage3NextStep } from './rotate-env-stage-output.js';
import { runStagedRotation, type StagedRotationOptions } from './rotate-env-stages.js';
import { DEFAULT_SERVICE_POLL_INTERVAL_MS } from './service-redeploy-wait.js';
import { UsageError } from '../utils/errors.js';

const mockAssertReady = vi.mocked(assertRailwayServiceDeploymentReady);
const mockGetLatestDeployment = vi.mocked(getRailwayServiceLatestDeployment);
const mockRedeployVerifier = vi.mocked(redeployRailwayServiceReusingImageWithSource);
const mockUpsert = vi.mocked(upsertRailwayVariable);
const mockDelete = vi.mocked(deleteRailwayVariable);
const mockReadValue = vi.mocked(readRailwayVariableValue);
const mockListNames = vi.mocked(listRailwayVariableNames);
const mockConfirm = vi.mocked(confirmPrompt);
const mockGate = vi.mocked(checkDeployedCodeAcceptsPrevious);
const mockRedeploy = vi.mocked(redeployServices);
const mockReportFailures = vi.mocked(reportRedeployFailures);
const mockMarkRotated = vi.mocked(stampLedger);

const VAR_NAME = 'INTERNAL_SERVICE_SECRET';
const PREVIOUS_NAME = `${VAR_NAME}_PREVIOUS`;
const SENTINEL_VALUE = 'sentinel-current-value-do-not-log';
const SENTINEL_PREVIOUS_VALUE = 'sentinel-previous-value-do-not-log';

const SERVICES = [
  { id: 'svc-gateway', name: 'api-gateway' },
  { id: 'svc-bot', name: 'bot-client' },
  { id: 'svc-ai', name: 'ai-worker' },
];

/**
 * A stand-in for the verifier's EFFECTIVE variable set. Stage 1 both WRITES
 * `_PREVIOUS` and then READS the verifier's names back, so one static mock
 * return cannot serve both calls — observing what the write did is the whole
 * point of the read-back. Only a SERVICE-SCOPED upsert lands here, which is
 * exactly Railway's behaviour: a newly created SHARED variable is inherited by
 * nothing until it is enabled for a service.
 */
let verifierNames: Set<string>;

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
    stage: '1',
    dryRun: false,
    yes: true,
    verifierService: 'api-gateway',
    ...overrides,
  };
}

describe('runStagedRotation', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    verifierNames = new Set([VAR_NAME]);
    mockAssertReady.mockReset().mockResolvedValue(undefined);
    mockRedeployVerifier.mockReset().mockResolvedValue({
      sourceDeploymentId: 'dep-verifier-old',
      newDeploymentId: 'dep-verifier-stage2',
    });
    mockGetLatestDeployment
      .mockReset()
      .mockResolvedValue({ id: 'dep-verifier-stage2', status: 'SUCCESS' });
    mockUpsert.mockReset().mockImplementation(async args => {
      if (args.serviceId !== undefined) {
        verifierNames.add(args.name);
      }
    });
    mockListNames.mockReset().mockImplementation(async () => [...verifierNames]);
    mockDelete.mockReset().mockResolvedValue(undefined);
    // Default: a NORMAL (non-degenerate) open window — the primary and
    // `_PREVIOUS` read back as DIFFERENT values. Tests exercising the
    // degenerate-window paths override this per-call.
    mockReadValue
      .mockReset()
      .mockImplementation(async args =>
        args.name === PREVIOUS_NAME ? SENTINEL_PREVIOUS_VALUE : SENTINEL_VALUE
      );
    mockConfirm.mockReset().mockResolvedValue(true);
    mockGate.mockReset().mockResolvedValue({ ok: true, commit: 'abc123' });
    mockRedeploy.mockReset().mockResolvedValue([]);
    mockReportFailures.mockReset();
    mockMarkRotated.mockReset().mockResolvedValue(true);

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unknown stage is a usage error naming the three stages', async () => {
    await expect(runStagedRotation(makeOptions({ stage: 'bogus' }), makeContext())).rejects.toThrow(
      UsageError
    );
    await expect(runStagedRotation(makeOptions({ stage: 'bogus' }), makeContext())).rejects.toThrow(
      /1\|stage.*2\|roll.*3\|finalize/s
    );
  });

  // An inherited Object.prototype key resolves to a non-undefined value under a
  // bare index lookup, which would slip past the unknown-stage guard and fall
  // through into stage 3 — the destructive stage.
  it.each(['constructor', 'toString', '__proto__'])(
    'an inherited prototype key (%s) is an unknown stage, not a fall-through to stage 3',
    async stage => {
      // The window is deliberately OPEN here: with it closed, stage 3 would
      // refuse anyway and this case would pass without discriminating.
      verifierNames.add(PREVIOUS_NAME);
      const context = makeContext();

      await expect(runStagedRotation(makeOptions({ stage }), context)).rejects.toThrow(UsageError);
      expect(mockDelete).not.toHaveBeenCalled();
      expect(mockRedeploy).not.toHaveBeenCalled();
    }
  );

  it('refuses when the verifier does not inherit the variable', async () => {
    const context = makeContext({ affectedServices: [{ id: 'svc-bot', name: 'bot-client' }] });

    await expect(runStagedRotation(makeOptions(), context)).rejects.toThrow(UsageError);
  });

  it("stage 1 refuses when the verifier's live commit does not accept the previous value", async () => {
    mockGate.mockResolvedValue({ ok: false, commit: 'abc123', reason: 'no token' });
    const context = makeContext();

    await expect(runStagedRotation(makeOptions({ stage: '1' }), context)).rejects.toThrow(
      UsageError
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('stage 1 refuses to open a second window while one is already open', async () => {
    mockGate.mockResolvedValue({ ok: true, commit: 'abc123' });
    verifierNames.add(PREVIOUS_NAME);
    const context = makeContext();

    await expect(runStagedRotation(makeOptions({ stage: '1' }), context)).rejects.toThrow(
      UsageError
    );
    await expect(runStagedRotation(makeOptions({ stage: '1' }), context)).rejects.toThrow(
      /stage 2.*stage 3/s
    );
    await expect(runStagedRotation(makeOptions({ stage: '1' }), context)).rejects.toThrow(
      /Stage 2 itself redeploys "api-gateway" and waits for SUCCESS first.*recoverable by running stage 2/is
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('stage 1 resumes (mints a new primary) when _PREVIOUS equals the current primary', async () => {
    // Degenerate window: both reads return the SAME value, the signature of a
    // stage 1 that upserted `_PREVIOUS` but died before minting a fresh primary.
    mockReadValue.mockReset().mockResolvedValue(SENTINEL_VALUE);
    verifierNames.add(PREVIOUS_NAME);
    const context = makeContext();

    await runStagedRotation(makeOptions({ stage: '1' }), context);

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const firstCall = mockUpsert.mock.calls[0][0];
    expect(firstCall.name).toBe(PREVIOUS_NAME);
    expect(firstCall.value).toBe(SENTINEL_VALUE);
    const secondCall = mockUpsert.mock.calls[1][0];
    expect(secondCall.name).toBe(VAR_NAME);
    expect(secondCall.value).not.toBe(SENTINEL_VALUE);

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toMatch(/half-completed/i);
  });

  it('stage 1 preserves the current value as _PREVIOUS and mints a new primary', async () => {
    const context = makeContext();

    await runStagedRotation(makeOptions({ stage: '1' }), context);

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const firstCall = mockUpsert.mock.calls[0][0];
    expect(firstCall.name).toBe(PREVIOUS_NAME);
    expect(firstCall.value).toBe(SENTINEL_VALUE);
    expect(firstCall.skipDeploys).toBe(true);
    expect(firstCall.serviceId).toBe('svc-gateway');

    const secondCall = mockUpsert.mock.calls[1][0];
    expect(secondCall.name).toBe(VAR_NAME);
    expect(secondCall.value).toMatch(/^[0-9a-f]{64}$/);
    expect(secondCall.value).not.toBe(SENTINEL_VALUE);
    expect(secondCall.skipDeploys).toBe(true);
    expect(Object.hasOwn(secondCall, 'serviceId')).toBe(false);
  });

  it('stage 1 leaves a degenerate state when the first upsert succeeds but the second rejects', async () => {
    const context = makeContext();
    mockUpsert
      .mockReset()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Railway upsert failed'));

    await expect(runStagedRotation(makeOptions({ stage: '1' }), context)).rejects.toThrow();

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const firstCall = mockUpsert.mock.calls[0][0];
    expect(firstCall.name).toBe(PREVIOUS_NAME);
    expect(firstCall.value).toBe(SENTINEL_VALUE);
  });

  it('stage 1 redeploys only the verifier', async () => {
    const context = makeContext();

    await runStagedRotation(makeOptions({ stage: '1' }), context);

    expect(mockRedeploy).toHaveBeenCalledTimes(1);
    expect(mockRedeploy).toHaveBeenCalledWith([{ id: 'svc-gateway', name: 'api-gateway' }], {
      environmentId: 'env-1',
      env: 'dev',
    });
  });

  it('stage 1 tells the operator not to re-run stage 1 and to confirm the verifier shows SUCCESS when its redeploy fails', async () => {
    mockRedeploy.mockResolvedValue([{ name: 'api-gateway', error: new Error('boom') }]);

    const rejection = runStagedRotation(makeOptions({ stage: '1' }), makeContext());

    await expect(rejection).rejects.toThrow(/Do NOT re-run stage 1/);
    await expect(rejection).rejects.toThrow(/"api-gateway" shows SUCCESS/);
  });

  it('stage 1 prints the same next-step clause its thrown error carries (the report closing)', async () => {
    mockRedeploy.mockResolvedValue([{ name: 'api-gateway', error: new Error('boom') }]);

    const error = await runStagedRotation(makeOptions({ stage: '1' }), makeContext()).then(
      () => new Error('stage 1 did not throw'),
      (e: unknown) => e as Error
    );

    expect(mockReportFailures).toHaveBeenCalledTimes(1);
    const closing = mockReportFailures.mock.calls[0][3];
    expect(closing).toBe(stage1NextStep('api-gateway'));
    expect(error.message).toContain(closing);
  });

  it('stage 2 prints the same next-step clause its thrown error carries (the report closing)', async () => {
    verifierNames.add(PREVIOUS_NAME);
    mockRedeploy.mockResolvedValue([{ name: 'bot-client', error: new Error('boom') }]);

    const error = await runStagedRotation(makeOptions({ stage: '2' }), makeContext()).then(
      () => new Error('stage 2 did not throw'),
      (e: unknown) => e as Error
    );

    expect(mockReportFailures).toHaveBeenCalledTimes(1);
    const closing = mockReportFailures.mock.calls[0][3];
    expect(closing).toBe(STAGE2_NEXT_STEP);
    expect(error.message).toContain(closing);
  });

  it('stage 3 prints the same next-step clause its thrown error carries (the report closing)', async () => {
    const failures = [{ name: 'api-gateway', error: new Error('boom') }];
    mockRedeploy.mockResolvedValue(failures);
    verifierNames.add(PREVIOUS_NAME);

    const error = await runStagedRotation(makeOptions({ stage: '3' }), makeContext()).then(
      () => new Error('stage 3 did not throw'),
      (e: unknown) => e as Error
    );

    expect(mockReportFailures).toHaveBeenCalledTimes(1);
    const closing = mockReportFailures.mock.calls[0][3];
    expect(closing).toBe(
      stage3NextStep({
        verifierName: 'api-gateway',
        failures,
        ledgerName: 'internal-service-secret',
        env: 'dev',
      })
    );
    expect(closing).toContain('Do NOT re-run this command');
    expect(error.message).toContain(closing);
  });

  // `reportRedeployFailures` prints an unconditional "⚠️ N service(s) failed to
  // redeploy" banner plus repair instructions, so calling it with an empty list
  // tells the operator a successful stage failed.
  it.each([
    { stage: '1', openWindow: false },
    { stage: '2', openWindow: true },
    { stage: '3', openWindow: true },
  ])('stage $stage prints no failure banner when every redeploy succeeded', async fixture => {
    mockRedeploy.mockResolvedValue([]);
    if (fixture.openWindow) {
      verifierNames.add(PREVIOUS_NAME);
    }

    await runStagedRotation(makeOptions({ stage: fixture.stage }), makeContext());

    expect(mockReportFailures).not.toHaveBeenCalled();
  });

  it('stage 1 does not stamp the ledger', async () => {
    const context = makeContext();

    await runStagedRotation(makeOptions({ stage: '1' }), context);

    expect(mockMarkRotated).not.toHaveBeenCalled();
  });

  it('stage 1 never prints the current value', async () => {
    const context = makeContext();

    await runStagedRotation(makeOptions({ stage: '1' }), context);

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).not.toContain(SENTINEL_VALUE);
  });

  it('stage 2 redeploys every inheriting service except the verifier and writes no variables', async () => {
    verifierNames.add(PREVIOUS_NAME);
    const context = makeContext();

    await runStagedRotation(makeOptions({ stage: '2' }), context);

    expect(mockRedeploy).toHaveBeenCalledTimes(1);
    expect(mockRedeploy).toHaveBeenCalledWith(
      [
        { id: 'svc-bot', name: 'bot-client' },
        { id: 'svc-ai', name: 'ai-worker' },
      ],
      {
        environmentId: 'env-1',
        env: 'dev',
      }
    );
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('stage 2 refuses when no window is open', async () => {
    const context = makeContext();

    await expect(runStagedRotation(makeOptions({ stage: '2' }), context)).rejects.toThrow(
      UsageError
    );
  });

  it('stage 3 deletes _PREVIOUS rather than emptying it', async () => {
    verifierNames.add(PREVIOUS_NAME);
    const context = makeContext();

    await runStagedRotation(makeOptions({ stage: '3' }), context);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    const deleteArg = mockDelete.mock.calls[0][0];
    expect(deleteArg.name).toBe(PREVIOUS_NAME);
    expect(deleteArg.serviceId).toBe('svc-gateway');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('stage 3 redeploys the verifier and stamps the ledger', async () => {
    verifierNames.add(PREVIOUS_NAME);
    const context = makeContext();

    await runStagedRotation(makeOptions({ stage: '3' }), context);

    expect(mockRedeploy).toHaveBeenCalledTimes(1);
    expect(mockRedeploy).toHaveBeenCalledWith([{ id: 'svc-gateway', name: 'api-gateway' }], {
      environmentId: 'env-1',
      env: 'dev',
    });
    expect(mockMarkRotated).toHaveBeenCalledWith('dev', 'internal-service-secret');
  });

  it('stage 3 does not stamp the ledger when the verifier redeploy fails, and does not claim the window is closed', async () => {
    mockRedeploy.mockResolvedValue([{ name: 'api-gateway', error: new Error('boom') }]);
    verifierNames.add(PREVIOUS_NAME);
    const context = makeContext();

    await expect(runStagedRotation(makeOptions({ stage: '3' }), context)).rejects.toThrow(
      /secrets:mark-rotated/
    );

    expect(mockMarkRotated).not.toHaveBeenCalled();

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).not.toMatch(/Window: closed/);
    expect(allOutput).not.toMatch(/Ledger:/);

    // reportRedeployFailures is mocked in this file, so the wording is asserted on
    // the call args (the single-shot-specific consequence sentence must not leak
    // into a staged call site's message).
    expect(mockReportFailures).toHaveBeenCalledTimes(1);
    const [, consequence] = mockReportFailures.mock.calls[0];
    expect(consequence).not.toMatch(/THIRD value/);
    expect(consequence).toMatch(/was deleted/);
  });

  it('stage 1 failure error names all four terminal states and the dashboard, not a hand redeploy', async () => {
    mockRedeploy.mockResolvedValue([{ name: 'api-gateway', error: new Error('boom') }]);

    const rejection = runStagedRotation(makeOptions({ stage: '1' }), makeContext());

    await expect(rejection).rejects.toThrow(/FAILED, CRASHED, REMOVED or SKIPPED/);
    await expect(rejection).rejects.toThrow(
      /Railway dashboard until its latest deployment is SUCCESS/
    );
    await expect(rejection).rejects.toThrow(/`pnpm ops deploy:redeploy` refuses it too/);
    await expect(rejection).rejects.not.toThrow(/by hand/);
  });

  it('stage 2 failure error names all four terminal states and the dashboard, not a hand redeploy', async () => {
    verifierNames.add(PREVIOUS_NAME);
    mockRedeploy.mockResolvedValue([{ name: 'bot-client', error: new Error('boom') }]);

    const rejection = runStagedRotation(makeOptions({ stage: '2' }), makeContext());

    await expect(rejection).rejects.toThrow(/FAILED, CRASHED, REMOVED or SKIPPED/);
    await expect(rejection).rejects.toThrow(
      /Railway dashboard until its latest deployment is SUCCESS/
    );
    await expect(rejection).rejects.not.toThrow(/by hand/);
  });

  it('stage 3 sends a REFUSED verifier redeploy to the dashboard first, with the deploy:redeploy command only as the retry, and keeps the ledger sentence', async () => {
    mockRedeploy.mockResolvedValue([
      {
        name: 'api-gateway',
        error: new RailwayRedeployRefusedError('latest deployment is BUILDING'),
      },
    ]);
    verifierNames.add(PREVIOUS_NAME);

    const error = await runStagedRotation(makeOptions({ stage: '3' }), makeContext()).then(
      () => new Error('expected a rejection'),
      (e: unknown) => e as Error
    );

    expect(error.message).toContain(
      'Do NOT re-run this command — api-gateway: the redeploy was refused because the latest deployment is not SUCCESS — wait for it to settle, or fix it in the Railway dashboard, then redeploy it with `pnpm ops deploy:redeploy --env dev --service api-gateway --yes`, wait for it to reach SUCCESS, then stamp the ledger with `pnpm ops secrets:mark-rotated internal-service-secret --env dev`.'
    );
    expect(error.message).not.toContain('by hand');
    expect(mockMarkRotated).not.toHaveBeenCalled();
  });

  it('stage 3 keeps the by-hand wording and the ledger sentence for a plain verifier redeploy failure', async () => {
    mockRedeploy.mockResolvedValue([{ name: 'api-gateway', error: new Error('boom') }]);
    verifierNames.add(PREVIOUS_NAME);

    const error = await runStagedRotation(makeOptions({ stage: '3' }), makeContext()).then(
      () => new Error('expected a rejection'),
      (e: unknown) => e as Error
    );

    expect(error.message).toContain(
      'Do NOT re-run this command — redeploy "api-gateway" by hand and wait for it to reach SUCCESS, then stamp the ledger with `pnpm ops secrets:mark-rotated internal-service-secret --env dev`.'
    );
    expect(error.message).not.toContain('refused');
  });

  it('stage 3 refuses when no window is open', async () => {
    const context = makeContext();

    await expect(runStagedRotation(makeOptions({ stage: '3' }), context)).rejects.toThrow(
      UsageError
    );
  });

  it('stage 3 refuses to stamp a no-op rotation when _PREVIOUS equals the primary', async () => {
    // Degenerate window: the primary was never rotated — only stage 1's first
    // upsert (preserving `_PREVIOUS`) landed.
    mockReadValue.mockReset().mockResolvedValue(SENTINEL_VALUE);
    verifierNames.add(PREVIOUS_NAME);
    const context = makeContext();

    await expect(runStagedRotation(makeOptions({ stage: '3' }), context)).rejects.toThrow(
      UsageError
    );
    await expect(runStagedRotation(makeOptions({ stage: '3' }), context)).rejects.toThrow(
      /never rotated/
    );
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();
  });

  it('a dry run of stage 3 against a degenerate window prints REFUSE and changes nothing', async () => {
    mockReadValue.mockReset().mockResolvedValue(SENTINEL_VALUE);
    verifierNames.add(PREVIOUS_NAME);
    const context = makeContext();

    await runStagedRotation(makeOptions({ stage: '3', dryRun: true }), context);

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toMatch(/REFUSE/);
    expect(allOutput).not.toContain(SENTINEL_VALUE);
    expect(allOutput).not.toContain(SENTINEL_PREVIOUS_VALUE);
  });

  it('neither the stage 1 resume path nor the stage 3 refuse path prints a secret value', async () => {
    mockReadValue.mockReset().mockResolvedValue(SENTINEL_VALUE);
    verifierNames.add(PREVIOUS_NAME);
    const context = makeContext();

    await runStagedRotation(makeOptions({ stage: '1' }), context);
    await expect(runStagedRotation(makeOptions({ stage: '3' }), context)).rejects.toThrow(
      UsageError
    );

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).not.toContain(SENTINEL_VALUE);
    expect(allOutput).not.toContain(SENTINEL_PREVIOUS_VALUE);
  });

  it('a dry run of stage 1 prints the gate verdict and changes nothing', async () => {
    const context = makeContext();

    await runStagedRotation(makeOptions({ stage: '1', dryRun: true }), context);

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
    expect(mockMarkRotated).not.toHaveBeenCalled();

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toMatch(/gate/i);
  });

  it('a dry run of stage 1 with a refusing gate prints REFUSE and suppresses the plan', async () => {
    mockGate.mockResolvedValue({ ok: false, commit: 'abc123', reason: 'no token' });
    const context = makeContext();

    await runStagedRotation(makeOptions({ stage: '1', dryRun: true }), context);

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toMatch(/REFUSE/);
    expect(allOutput).not.toMatch(/Plan:/);
  });

  it('--yes is refused on prod', async () => {
    const context = makeContext();

    await expect(
      runStagedRotation(makeOptions({ env: 'prod', yes: true }), context)
    ).rejects.toThrow(/refused on prod/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('stage 1 refuses to redeploy when _PREVIOUS did not reach the verifier', async () => {
    // The shipped bug, reproduced: the upsert lands somewhere the verifier's
    // effective set never shows it (a shared-tier write it does not inherit).
    mockUpsert.mockReset().mockResolvedValue(undefined);

    await expect(runStagedRotation(makeOptions({ stage: '1' }), makeContext())).rejects.toThrow(
      /not visible in "api-gateway"'s effective variable set/
    );

    // The ordering is the whole point: refusing is recoverable, redeploying is the outage.
    expect(mockRedeploy).not.toHaveBeenCalled();
  });

  it('the stage 1 read-back refusal names no secret value', async () => {
    mockUpsert.mockReset().mockResolvedValue(undefined);

    const error = await runStagedRotation(makeOptions({ stage: '1' }), makeContext()).catch(
      (err: unknown) => err
    );

    expect(String(error)).not.toContain(SENTINEL_VALUE);
    expect(String(error)).not.toContain(SENTINEL_PREVIOUS_VALUE);

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).not.toContain(SENTINEL_VALUE);
  });

  it('window detection asks the verifier, not the shared tier', async () => {
    // A `_PREVIOUS` sitting at the shared tier that the verifier does not
    // inherit is NOT an open window — reading `sharedNames` would call it one.
    const context = makeContext({ sharedNames: [VAR_NAME, PREVIOUS_NAME] });

    await runStagedRotation(makeOptions({ stage: '1' }), context);

    expect(mockListNames).toHaveBeenCalled();
    const listArg = mockListNames.mock.calls[0][0];
    expect(listArg.serviceId).toBe('svc-gateway');
    // Stage 1 proceeded rather than refusing "a window is already open".
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  it('stage 1 refuses before any upsert or redeploy when the verifier deployment is not ready', async () => {
    mockAssertReady.mockRejectedValueOnce(
      new Error(
        "api-gateway's latest deployment is INITIALIZING, not SUCCESS — wait for it to settle (or fix it), then re-run. Nothing was changed."
      )
    );

    await expect(runStagedRotation(makeOptions({ stage: '1' }), makeContext())).rejects.toThrow(
      'api-gateway'
    );

    expect(mockAssertReady).toHaveBeenCalledWith({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      env: 'dev',
    });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
  });

  it('stage 2 checks the verifier and every presenter, and refuses before redeploying if the verifier is not ready', async () => {
    verifierNames.add(PREVIOUS_NAME);
    mockAssertReady.mockImplementation(async args => {
      if (args.serviceName === 'api-gateway') {
        throw new Error(
          "api-gateway's latest deployment is INITIALIZING, not SUCCESS — wait for it to settle (or fix it), then re-run. Nothing was changed."
        );
      }
    });

    await expect(runStagedRotation(makeOptions({ stage: '2' }), makeContext())).rejects.toThrow(
      'api-gateway'
    );

    expect(mockAssertReady).toHaveBeenCalledWith({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      env: 'dev',
    });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
  });

  it('stage 2 refuses before redeploying any presenter when a presenter deployment is not ready', async () => {
    verifierNames.add(PREVIOUS_NAME);
    mockAssertReady.mockImplementation(async args => {
      if (args.serviceName === 'ai-worker') {
        throw new Error(
          "ai-worker's latest deployment is BUILDING, not SUCCESS — wait for it to settle (or fix it), then re-run. Nothing was changed."
        );
      }
    });

    await expect(runStagedRotation(makeOptions({ stage: '2' }), makeContext())).rejects.toThrow(
      'ai-worker'
    );

    expect(mockAssertReady).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'api-gateway' })
    );
    expect(mockAssertReady).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'bot-client' })
    );
    expect(mockAssertReady).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'ai-worker' })
    );
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
  });

  it('stage 3 refuses before deleting _PREVIOUS or redeploying when the verifier deployment is not ready', async () => {
    verifierNames.add(PREVIOUS_NAME);
    mockAssertReady.mockRejectedValueOnce(
      new Error(
        "api-gateway's latest deployment is INITIALIZING, not SUCCESS — wait for it to settle (or fix it), then re-run. Nothing was changed."
      )
    );

    await expect(runStagedRotation(makeOptions({ stage: '3' }), makeContext())).rejects.toThrow(
      'api-gateway'
    );

    expect(mockAssertReady).toHaveBeenCalledWith({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      env: 'dev',
    });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
  });

  it.each([
    { stage: '1', openWindow: false },
    { stage: '2', openWindow: true },
    { stage: '3', openWindow: true },
  ])('dry run of stage $stage never calls the deployment readiness check', async fixture => {
    if (fixture.openWindow) {
      verifierNames.add(PREVIOUS_NAME);
    }

    await runStagedRotation(makeOptions({ stage: fixture.stage, dryRun: true }), makeContext());

    expect(mockAssertReady).not.toHaveBeenCalled();
  });

  it('stage 2 redeploys the verifier and waits for the new deployment to reach SUCCESS before redeploying presenters', async () => {
    vi.useFakeTimers();
    try {
      verifierNames.add(PREVIOUS_NAME);
      const events: string[] = [];

      mockAssertReady.mockImplementation(async args => {
        events.push(`ready:${args.serviceName}`);
      });
      mockRedeployVerifier.mockImplementation(async args => {
        events.push(`redeploy-verifier:${args.serviceName}`);
        return { sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-verifier-stage2' };
      });
      mockGetLatestDeployment
        .mockImplementationOnce(async () => {
          events.push('poll:dep-old:SUCCESS');
          return { id: 'dep-old', status: 'SUCCESS' };
        })
        .mockImplementationOnce(async () => {
          events.push('poll:dep-verifier-stage2:BUILDING');
          return { id: 'dep-verifier-stage2', status: 'BUILDING' };
        })
        .mockImplementationOnce(async () => {
          events.push('poll:dep-verifier-stage2:SUCCESS');
          return { id: 'dep-verifier-stage2', status: 'SUCCESS' };
        })
        .mockImplementationOnce(async args => {
          events.push(`presenter-ready:${args.serviceId}:SUCCESS`);
          return { id: 'dep-bot', status: 'SUCCESS' };
        })
        .mockImplementationOnce(async args => {
          events.push(`presenter-ready:${args.serviceId}:SUCCESS`);
          return { id: 'dep-ai', status: 'SUCCESS' };
        });
      mockRedeploy.mockImplementation(async services => {
        events.push(`redeploy-presenters:${services.map(svc => svc.name).join(',')}`);
        return [];
      });

      const promise = runStagedRotation(makeOptions({ stage: '2' }), makeContext());
      await vi.advanceTimersByTimeAsync(DEFAULT_SERVICE_POLL_INTERVAL_MS * 2);
      await promise;

      expect(mockRedeployVerifier).toHaveBeenCalledTimes(1);
      expect(mockRedeployVerifier).toHaveBeenCalledWith({
        environmentId: 'env-1',
        serviceId: 'svc-gateway',
        serviceName: 'api-gateway',
        env: 'dev',
      });
      expect(mockGetLatestDeployment).toHaveBeenCalledTimes(5);
      expect(mockRedeploy).toHaveBeenCalledTimes(1);
      const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
      expect(allOutput).toMatch(/Next: pnpm ops secrets:rotate-env .*--stage 3/);
      expect(events).toEqual([
        'ready:api-gateway',
        'ready:bot-client',
        'ready:ai-worker',
        'redeploy-verifier:api-gateway',
        'poll:dep-old:SUCCESS',
        'poll:dep-verifier-stage2:BUILDING',
        'poll:dep-verifier-stage2:SUCCESS',
        'presenter-ready:svc-bot:SUCCESS',
        'presenter-ready:svc-ai:SUCCESS',
        'redeploy-presenters:bot-client,ai-worker',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stage 2 refuses and leaves presenters untouched when the verifier redeploy reaches a terminal failure status', async () => {
    vi.useFakeTimers();
    try {
      verifierNames.add(PREVIOUS_NAME);
      mockGetLatestDeployment.mockResolvedValue({
        id: 'dep-verifier-stage2',
        status: 'CRASHED',
      });

      await expect(runStagedRotation(makeOptions({ stage: '2' }), makeContext())).rejects.toThrow(
        /api-gateway.*CRASHED.*nothing was redeployed on presenters/s
      );

      expect(mockRedeployVerifier).toHaveBeenCalledTimes(1);
      expect(mockRedeploy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stage 2 refuses and leaves presenters untouched when triggering the verifier redeploy rejects', async () => {
    verifierNames.add(PREVIOUS_NAME);
    mockRedeployVerifier.mockRejectedValueOnce(new Error('verifier redeploy failed'));

    await expect(runStagedRotation(makeOptions({ stage: '2' }), makeContext())).rejects.toThrow(
      'verifier redeploy failed'
    );

    expect(mockRedeployVerifier).toHaveBeenCalledTimes(1);
    expect(mockGetLatestDeployment).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
  });

  it('stage 2 refuses to redeploy any presenter when a presenter flips to BUILDING during the verifier wait', async () => {
    vi.useFakeTimers();
    try {
      verifierNames.add(PREVIOUS_NAME);
      mockGetLatestDeployment
        .mockResolvedValueOnce({ id: 'dep-verifier-stage2', status: 'SUCCESS' })
        .mockResolvedValueOnce({ id: 'dep-bot', status: 'BUILDING' })
        .mockResolvedValueOnce({ id: 'dep-ai', status: 'SUCCESS' });

      await expect(runStagedRotation(makeOptions({ stage: '2' }), makeContext())).rejects.toThrow(
        /bot-client.*BUILDING/
      );

      expect(mockRedeployVerifier).toHaveBeenCalledTimes(1);
      expect(mockGetLatestDeployment).toHaveBeenCalledTimes(3);
      expect(mockRedeploy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stage 2 dry run prints the verifier redeploy-and-wait plan line and makes no deployment calls', async () => {
    verifierNames.add(PREVIOUS_NAME);

    await runStagedRotation(makeOptions({ stage: '2', dryRun: true }), makeContext());

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toContain('Plan: redeploy "api-gateway" first and wait for SUCCESS');
    expect(allOutput).toContain('Plan: redeploy bot-client, ai-worker');
    expect(
      allOutput.indexOf('Plan: redeploy "api-gateway" first and wait for SUCCESS')
    ).toBeLessThan(allOutput.indexOf('Plan: redeploy bot-client, ai-worker'));
    expect(mockRedeployVerifier).not.toHaveBeenCalled();
    expect(mockGetLatestDeployment).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
  });

  it('stage 2 confirmation prompt mentions the verifier restart and waiting for SUCCESS', async () => {
    verifierNames.add(PREVIOUS_NAME);

    await runStagedRotation(makeOptions({ stage: '2', yes: false }), makeContext());

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.stringMatching(/restart the verifier.*wait for SUCCESS/i)
    );
  });

  it('stage 1 dry run with an open non-degenerate window explains that stage 2 redeploys the verifier first', async () => {
    verifierNames.add(PREVIOUS_NAME);

    await runStagedRotation(makeOptions({ stage: '1', dryRun: true }), makeContext());

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toMatch(
      /Stage 2 itself redeploys "api-gateway" and waits for it to reach SUCCESS first.*recoverable by running stage 2/is
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('stage 2 makes no verifier or presenter redeploy call when no window is open', async () => {
    await expect(runStagedRotation(makeOptions({ stage: '2' }), makeContext())).rejects.toThrow(
      UsageError
    );

    expect(mockAssertReady).not.toHaveBeenCalled();
    expect(mockRedeployVerifier).not.toHaveBeenCalled();
    expect(mockGetLatestDeployment).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
  });

  it('stage 2 presenter failure report states that nothing was written and the verifier already restarted onto the new primary', async () => {
    verifierNames.add(PREVIOUS_NAME);
    mockRedeploy.mockResolvedValue([{ name: 'bot-client', error: new Error('boom') }]);

    await expect(runStagedRotation(makeOptions({ stage: '2' }), makeContext())).rejects.toThrow(
      'secrets:rotate-env stage 2: 1 service(s) failed to redeploy. Re-run stage 2 once every lagging service shows SUCCESS (its preflight refuses until every service does); a service whose latest deployment ended FAILED, CRASHED, REMOVED or SKIPPED must be fixed in the Railway dashboard until its latest deployment is SUCCESS first (`pnpm ops deploy:redeploy` refuses it too).'
    );

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).not.toContain('--stage 3');

    expect(mockReportFailures).toHaveBeenCalledTimes(1);
    const [failures, consequence, env] = mockReportFailures.mock.calls[0];
    expect(failures).toEqual([{ name: 'bot-client', error: expect.any(Error) }]);
    expect(consequence).not.toContain('only redeploys presenters');
    expect(consequence).toBe(
      'Nothing was written — the verifier restarted and its new deployment reached SUCCESS (per the stage-2 wait).'
    );
    expect(env).toBe('dev');
  });
});
