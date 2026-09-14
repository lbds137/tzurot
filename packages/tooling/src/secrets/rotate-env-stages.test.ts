import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../deployment/railway-api.js', () => ({
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

vi.mock('./rotate-env-context.js', async () => {
  const actual =
    await vi.importActual<typeof import('./rotate-env-context.js')>('./rotate-env-context.js');
  return {
    ...actual,
    redeployServices: vi.fn(),
    reportRedeployFailures: vi.fn(),
    stampLedger: vi.fn(),
  };
});

import {
  upsertRailwayVariable,
  deleteRailwayVariable,
  readRailwayVariableValue,
  listRailwayVariableNames,
} from '../deployment/railway-api.js';
import { confirmPrompt } from '../utils/confirm.js';
import { checkDeployedCodeAcceptsPrevious } from './deployed-code-gate.js';
import {
  redeployServices,
  reportRedeployFailures,
  stampLedger,
  type RotationContext,
} from './rotate-env-context.js';
import { runStagedRotation, type StagedRotationOptions } from './rotate-env-stages.js';
import { UsageError } from '../utils/errors.js';

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
      /confirm in the Railway dashboard.*redeploy actually landed/is
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
    const [services] = mockRedeploy.mock.calls[0];
    expect(services).toEqual([{ id: 'svc-gateway', name: 'api-gateway' }]);
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
    const [services] = mockRedeploy.mock.calls[0];
    expect(services).toEqual([
      { id: 'svc-bot', name: 'bot-client' },
      { id: 'svc-ai', name: 'ai-worker' },
    ]);
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
    const [services] = mockRedeploy.mock.calls[0];
    expect(services).toEqual([{ id: 'svc-gateway', name: 'api-gateway' }]);
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
});
