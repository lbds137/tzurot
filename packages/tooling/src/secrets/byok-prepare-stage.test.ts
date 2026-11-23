/**
 * Tests for BYOK stage 1 (prepare, drain, swap). One shared event log spans every
 * fake, with the REAL redeploy wait and the REAL removal wait running over injected
 * status fetchers, so the ordering that makes the rotation safe is observable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stageByokWindow, type StageByokWindowDeps } from './byok-prepare-stage.js';
import type { ByokServiceIds } from './byok-stage-helpers.js';
import { waitForDeploymentRemoved } from './deployment-removal-wait.js';
import { redeployAndWaitForService } from './service-redeploy-wait.js';

const { requireRailwayApiToken } = vi.hoisted(() => ({
  requireRailwayApiToken: vi.fn(),
}));

vi.mock('../deployment/railway-api.js', () => ({
  requireRailwayApiToken,
  // The partition helper does `instanceof` against this class on a failure's error.
  RailwayRedeployRefusedError: class RailwayRedeployRefusedError extends Error {
    name = 'RailwayRedeployRefusedError';
  },
}));

const KEY_A_HEX = 'a'.repeat(64);
const KEY_C_HEX = 'c'.repeat(64);
const KEY_D_HEX = 'd'.repeat(64);
const HEX64 = /[0-9a-f]{64}/;

const MOCK_IDS: ByokServiceIds = {
  'api-gateway': { projectId: 'proj', environmentId: 'envid', serviceId: 'svc-api-gateway' },
  'ai-worker': { projectId: 'proj', environmentId: 'envid', serviceId: 'svc-ai-worker' },
};

type VarStore = Record<string, Record<string, string>>;

interface HarnessOptions {
  vars?: VarStore;
  /** Status sequence per superseded deployment id (last entry repeats). Default: REMOVED. */
  removalStatuses?: Record<string, string[]>;
  /** Called after each removal poll, to mutate the store mid-wait. */
  onRemovalPoll?: (store: VarStore) => void;
  removalTimeoutMs?: number;
  /** Event-name prefixes whose fake rejects, e.g. `upsert:ai-worker:API_KEY_ENCRYPTION_KEY_NEXT`. */
  failOn?: string[];
  /** Live deployment ids per service name for the pre-swap check. Default: only the new deployment. */
  liveDeployments?: Record<string, string[]>;
  /** Per-service refusal from the image decrypt gate, on every call. Default: both images decrypt with NEXT. */
  imageGate?: ImageGateFailures;
  /**
   * Per-call outcomes, by 0-based call index across the whole run. The gate runs
   * twice per service: calls 0 (api-gateway) and 1 (ai-worker) before the first
   * write, calls 2 and 3 before the swap. A missing entry falls back to `imageGate`,
   * then to a pass on the run's own new deployment.
   */
  imageGateSequence?: ReadonlyArray<GateOutcomeByService | undefined>;
}

type ImageGateFailures = Partial<
  Record<'api-gateway' | 'ai-worker', { ok: false; reason: string }>
>;
type GateOutcomeByService = Partial<
  Record<
    'api-gateway' | 'ai-worker',
    | { ok: false; reason: string; deploymentId?: string }
    | { ok: true; commit: string; deploymentId: string }
  >
>;

function sameVars(vars: Record<string, string>): VarStore {
  return { 'api-gateway': { ...vars }, 'ai-worker': { ...vars } };
}

function makeHarness(options: HarnessOptions = {}): {
  deps: StageByokWindowDeps;
  events: string[];
  store: VarStore;
} {
  const events: string[] = [];
  const initial = options.vars ?? sameVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });
  const store: VarStore = {
    'api-gateway': { ...initial['api-gateway'] },
    'ai-worker': { ...initial['ai-worker'] },
  };
  const nameOf = (serviceId: string): string => serviceId.replace('svc-', '');
  const varsOf = (service: string): Record<string, string> => {
    const vars = store[service];
    if (vars === undefined) {
      throw new Error(`unknown service ${service}`);
    }
    return vars;
  };
  const maybeFail = (event: string): void => {
    if (options.failOn?.some(prefix => event.startsWith(prefix)) === true) {
      throw new Error(`injected failure at ${event}`);
    }
  };
  const removalPolls: Record<string, number> = {};
  let clock = 0;
  let gateCalls = 0;

  const deps = {
    env: 'dev',
    getServiceVariable: (_env: string, service: string, key: string) => {
      const value = varsOf(service)[key];
      if (value === undefined) {
        throw new Error(`${key} not found on ${service}`);
      }
      return value;
    },
    getServiceVariableOrEmpty: (_env: string, service: string, key: string) =>
      varsOf(service)[key] ?? '',
    resolveByokIds: () => MOCK_IDS,
    assertServiceDeploymentReady: vi.fn().mockResolvedValue(undefined),
    upsertVariable: vi.fn(async (args: { serviceId: string; name: string; value: string }) => {
      const event = `upsert:${nameOf(args.serviceId)}:${args.name}`;
      events.push(event);
      maybeFail(event);
      varsOf(nameOf(args.serviceId))[args.name] = args.value;
    }),
    deleteVariable: vi.fn(async (args: { serviceId: string; name: string }) => {
      const event = `delete:${nameOf(args.serviceId)}:${args.name}`;
      events.push(event);
      maybeFail(event);
      delete varsOf(nameOf(args.serviceId))[args.name];
    }),
    redeployWithSource: vi.fn(async (args: { serviceName: string }) => {
      events.push(`redeploy:${args.serviceName}`);
      return {
        sourceDeploymentId: `old-${args.serviceName}`,
        newDeploymentId: `new-${args.serviceName}`,
      };
    }),
    redeployAndWait: vi.fn((args: Parameters<typeof redeployAndWaitForService>[0]) =>
      redeployAndWaitForService({
        ...args,
        getLatestDeployment: async ({ serviceId }: { serviceId: string }) => {
          events.push(`latest:${nameOf(serviceId)}`);
          return { id: `new-${nameOf(serviceId)}`, status: 'SUCCESS' };
        },
        sleep: async () => undefined,
      } as Parameters<typeof redeployAndWaitForService>[0])
    ),
    waitForDeploymentRemoved: vi.fn((args: Parameters<typeof waitForDeploymentRemoved>[0]) =>
      waitForDeploymentRemoved({
        ...args,
        timeoutMs: options.removalTimeoutMs ?? 1000,
        pollIntervalMs: 10,
        getDeploymentStatus: async ({ deploymentId }: { deploymentId: string }) => {
          const sequence = options.removalStatuses?.[deploymentId] ?? ['REMOVED'];
          const index = removalPolls[deploymentId] ?? 0;
          removalPolls[deploymentId] = index + 1;
          const status = sequence[Math.min(index, sequence.length - 1)] ?? 'REMOVED';
          events.push(`status:${deploymentId}:${status}`);
          options.onRemovalPoll?.(store);
          return status;
        },
        sleep: async (ms: number) => {
          clock += ms;
        },
        now: () => clock,
      })
    ),
    listLiveDeploymentIds: vi.fn(async (args: { serviceId: string }) => {
      const service = nameOf(args.serviceId);
      return options.liveDeployments?.[service] ?? [`new-${service}`];
    }),
    checkDeployedCode: vi.fn(async (args: { serviceName: 'api-gateway' | 'ai-worker' }) => {
      const call = gateCalls;
      gateCalls += 1;
      events.push(`gate:${args.serviceName}`);
      return (
        options.imageGateSequence?.[call]?.[args.serviceName] ??
        options.imageGate?.[args.serviceName] ?? {
          ok: true,
          commit: 'c0ffee0000000000000000000000000000000000',
          // Matches the redeploy fake's newDeploymentId, so the run's own deployment passes.
          deploymentId: `new-${args.serviceName}`,
        }
      );
    }),
    redeployServices: vi.fn(async () => {
      events.push('redeployServices');
    }),
  } as unknown as StageByokWindowDeps;
  return { deps, events, store };
}

function written(events: string[], prefix: string): number[] {
  return events.flatMap((event, index) => (event.startsWith(prefix) ? [index] : []));
}

describe('stageByokWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRailwayApiToken.mockReturnValue('tok');
  });

  it('checks readiness for both services, stages NEXT, swaps PREVIOUS then CURRENT then deletes NEXT, prints one line per write, then redeploys', async () => {
    const { deps, store } = makeHarness();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await stageByokWindow(deps);

      expect(deps.assertServiceDeploymentReady).toHaveBeenCalledTimes(2);
      expect(deps.assertServiceDeploymentReady).toHaveBeenNthCalledWith(1, {
        environmentId: 'envid',
        serviceId: 'svc-api-gateway',
        serviceName: 'api-gateway',
        env: 'dev',
      });
      expect(deps.assertServiceDeploymentReady).toHaveBeenNthCalledWith(2, {
        environmentId: 'envid',
        serviceId: 'svc-ai-worker',
        serviceName: 'ai-worker',
        env: 'dev',
      });

      const upsert = vi.mocked(deps.upsertVariable);
      expect(upsert).toHaveBeenCalledTimes(6);
      expect(upsert.mock.calls[0][0]).toMatchObject({
        serviceId: 'svc-api-gateway',
        name: 'API_KEY_ENCRYPTION_KEY_NEXT',
        skipDeploys: true,
      });
      expect(upsert.mock.calls[1][0]).toMatchObject({
        serviceId: 'svc-ai-worker',
        name: 'API_KEY_ENCRYPTION_KEY_NEXT',
      });
      expect(upsert.mock.calls[2][0]).toMatchObject({
        serviceId: 'svc-api-gateway',
        name: 'API_KEY_ENCRYPTION_KEY_PREVIOUS',
        value: KEY_A_HEX,
      });
      expect(upsert.mock.calls[3][0]).toMatchObject({
        serviceId: 'svc-ai-worker',
        name: 'API_KEY_ENCRYPTION_KEY_PREVIOUS',
        value: KEY_A_HEX,
      });
      expect(upsert.mock.calls[4][0]).toMatchObject({
        serviceId: 'svc-api-gateway',
        name: 'API_KEY_ENCRYPTION_KEY',
      });
      expect(upsert.mock.calls[5][0]).toMatchObject({
        serviceId: 'svc-ai-worker',
        name: 'API_KEY_ENCRYPTION_KEY',
      });
      const stagedNext = (upsert.mock.calls[0][0] as { value: string }).value;
      expect((upsert.mock.calls[4][0] as { value: string }).value).toBe(stagedNext);

      const del = vi.mocked(deps.deleteVariable);
      expect(del).toHaveBeenCalledTimes(2);
      expect(del.mock.calls[0][0]).toMatchObject({
        serviceId: 'svc-api-gateway',
        name: 'API_KEY_ENCRYPTION_KEY_NEXT',
      });
      expect(del.mock.calls[1][0]).toMatchObject({
        serviceId: 'svc-ai-worker',
        name: 'API_KEY_ENCRYPTION_KEY_NEXT',
      });
      expect(deps.redeployServices).toHaveBeenCalledWith('dev', MOCK_IDS, expect.any(Function));
      expect(store['api-gateway']).toEqual({
        API_KEY_ENCRYPTION_KEY: stagedNext,
        API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_A_HEX,
      });

      const setLines = logSpy.mock.calls
        .map(call => String(call[0]))
        .filter(line => line.includes('  set '));
      expect(setLines).toHaveLength(6);
      expect(setLines[0]).toContain('  set API_KEY_ENCRYPTION_KEY_NEXT on api-gateway (dev)');
      expect(setLines[1]).toContain('  set API_KEY_ENCRYPTION_KEY_NEXT on ai-worker (dev)');
      expect(setLines[2]).toContain('  set API_KEY_ENCRYPTION_KEY_PREVIOUS on api-gateway (dev)');
      expect(setLines[3]).toContain('  set API_KEY_ENCRYPTION_KEY_PREVIOUS on ai-worker (dev)');
      expect(setLines[4]).toContain('  set API_KEY_ENCRYPTION_KEY on api-gateway (dev)');
      expect(setLines[5]).toContain('  set API_KEY_ENCRYPTION_KEY on ai-worker (dev)');
      const deleteLines = logSpy.mock.calls
        .map(call => String(call[0]))
        .filter(line => line.includes('  deleted '));
      expect(deleteLines).toHaveLength(2);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('refuses before any upsert when a service is not ready', async () => {
    const { deps } = makeHarness();
    vi.mocked(deps.assertServiceDeploymentReady).mockImplementation(async ({ serviceName }) => {
      if (serviceName === 'ai-worker') {
        throw new Error(
          "ai-worker's latest deployment is INITIALIZING, not SUCCESS — wait for it to settle (or fix it), then re-run. Nothing was changed."
        );
      }
    });

    await expect(stageByokWindow(deps)).rejects.toThrow(
      "ai-worker's latest deployment is INITIALIZING, not SUCCESS"
    );

    expect(deps.upsertVariable).not.toHaveBeenCalled();
    expect(deps.deleteVariable).not.toHaveBeenCalled();
    expect(deps.redeployAndWait).not.toHaveBeenCalled();
    expect(deps.redeployServices).not.toHaveBeenCalled();
  });

  describe('ordering (the purpose: the new key is decrypt-live everywhere before anyone encrypts with it)', () => {
    it('runs NEXT x2, then per service redeploy, new SUCCESS, old REMOVED, then PREVIOUS x2, CURRENT x2, delete NEXT x2, then the final redeploys', async () => {
      const { deps, events } = makeHarness();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        await stageByokWindow(deps);
      } finally {
        logSpy.mockRestore();
      }

      expect(events).toEqual([
        'gate:api-gateway',
        'gate:ai-worker',
        'upsert:api-gateway:API_KEY_ENCRYPTION_KEY_NEXT',
        'upsert:ai-worker:API_KEY_ENCRYPTION_KEY_NEXT',
        'redeploy:api-gateway',
        'latest:api-gateway',
        'status:old-api-gateway:REMOVED',
        'redeploy:ai-worker',
        'latest:ai-worker',
        'status:old-ai-worker:REMOVED',
        'gate:api-gateway',
        'gate:ai-worker',
        'upsert:api-gateway:API_KEY_ENCRYPTION_KEY_PREVIOUS',
        'upsert:ai-worker:API_KEY_ENCRYPTION_KEY_PREVIOUS',
        'upsert:api-gateway:API_KEY_ENCRYPTION_KEY',
        'upsert:ai-worker:API_KEY_ENCRYPTION_KEY',
        'delete:api-gateway:API_KEY_ENCRYPTION_KEY_NEXT',
        'delete:ai-worker:API_KEY_ENCRYPTION_KEY_NEXT',
        'redeployServices',
      ]);
    });

    it('polls the SUPERSEDED (source) deployment id, and holds the swap until it reports REMOVED after REMOVING twice', async () => {
      const { deps, events } = makeHarness({
        removalStatuses: { 'old-api-gateway': ['REMOVING', 'REMOVING', 'REMOVED'] },
      });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        await stageByokWindow(deps);
      } finally {
        logSpy.mockRestore();
      }

      const polledIds = events.filter(e => e.startsWith('status:')).map(e => e.split(':')[1]);
      expect(polledIds).toEqual([
        'old-api-gateway',
        'old-api-gateway',
        'old-api-gateway',
        'old-ai-worker',
      ]);
      const lastRemovedPoll = Math.max(...written(events, 'status:'));
      const firstSwapWrite = Math.min(
        ...written(events, 'upsert:api-gateway:API_KEY_ENCRYPTION_KEY_PREVIOUS')
      );
      expect(firstSwapWrite).toBeGreaterThan(lastRemovedPoll);
      expect(events.indexOf('status:old-api-gateway:REMOVED')).toBeLessThan(
        events.indexOf('redeploy:ai-worker')
      );
    });

    it('writes no PREVIOUS or CURRENT, deletes nothing and redeploys nothing more when the removal wait times out, with no key in the message', async () => {
      const { deps, events } = makeHarness({
        removalStatuses: { 'old-api-gateway': ['SUCCESS'] },
        removalTimeoutMs: 50,
      });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        const error = await stageByokWindow(deps).then(
          () => undefined,
          (e: unknown) => e as Error
        );

        expect(error?.message).toMatch(/to reach REMOVED/);
        expect(error?.message).toMatch(/API_KEY_ENCRYPTION_KEY has not changed/);
        expect(error?.message).not.toMatch(HEX64);
        expect(written(events, 'upsert:api-gateway:API_KEY_ENCRYPTION_KEY_PREVIOUS')).toHaveLength(
          0
        );
        expect(events).not.toContain('upsert:api-gateway:API_KEY_ENCRYPTION_KEY');
        expect(events).not.toContain('upsert:ai-worker:API_KEY_ENCRYPTION_KEY');
        expect(written(events, 'delete:')).toHaveLength(0);
        expect(events).not.toContain('redeploy:ai-worker');
        expect(events).not.toContain('redeployServices');
        const output = logSpy.mock.calls.flat().map(String).join('\n');
        expect(output).not.toMatch(HEX64);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('refuses to swap when CURRENT changed in Railway during the waits', async () => {
      const { deps, events } = makeHarness({
        onRemovalPoll: store => {
          const workerVars = store['ai-worker'];
          if (workerVars !== undefined) {
            workerVars.API_KEY_ENCRYPTION_KEY = KEY_D_HEX;
          }
        },
      });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        const error = await stageByokWindow(deps).then(
          () => undefined,
          (e: unknown) => e as Error
        );

        expect(error?.message).toMatch(
          /rotation keys changed in Railway while BYOK stage 1 waited/
        );
        expect(error?.message).not.toMatch(HEX64);
        expect(events).not.toContain('upsert:api-gateway:API_KEY_ENCRYPTION_KEY');
        expect(written(events, 'upsert:api-gateway:API_KEY_ENCRYPTION_KEY_PREVIOUS')).toHaveLength(
          0
        );
        expect(written(events, 'delete:')).toHaveLength(0);
        expect(events).not.toContain('redeployServices');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('refuses to swap when NEXT changed in Railway during the waits', async () => {
      const { deps, events } = makeHarness({
        onRemovalPoll: store => {
          const workerVars = store['ai-worker'];
          if (workerVars !== undefined) {
            workerVars.API_KEY_ENCRYPTION_KEY_NEXT = KEY_D_HEX;
          }
        },
      });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        const error = await stageByokWindow(deps).then(
          () => undefined,
          (e: unknown) => e as Error
        );

        expect(error?.message).toMatch(
          /rotation keys changed in Railway while BYOK stage 1 waited/
        );
        expect(error?.message).not.toMatch(HEX64);
        expect(events).not.toContain('upsert:api-gateway:API_KEY_ENCRYPTION_KEY');
        expect(events).not.toContain('upsert:ai-worker:API_KEY_ENCRYPTION_KEY');
        expect(written(events, 'upsert:api-gateway:API_KEY_ENCRYPTION_KEY_PREVIOUS')).toHaveLength(
          0
        );
        expect(written(events, 'delete:')).toHaveLength(0);
        expect(events).not.toContain('redeployServices');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('refuses to swap when ai-worker PREVIOUS changed in Railway during the waits', async () => {
      const { deps, events } = makeHarness({
        onRemovalPoll: store => {
          const workerVars = store['ai-worker'];
          if (workerVars !== undefined) {
            workerVars.API_KEY_ENCRYPTION_KEY_PREVIOUS = KEY_D_HEX;
          }
        },
      });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        const error = await stageByokWindow(deps).then(
          () => undefined,
          (e: unknown) => e as Error
        );

        expect(error?.message).toMatch(
          /rotation keys changed in Railway while BYOK stage 1 waited/
        );
        expect(error?.message).not.toMatch(HEX64);
        expect(events).not.toContain('upsert:api-gateway:API_KEY_ENCRYPTION_KEY');
        expect(events).not.toContain('upsert:ai-worker:API_KEY_ENCRYPTION_KEY');
        expect(written(events, 'upsert:api-gateway:API_KEY_ENCRYPTION_KEY_PREVIOUS')).toHaveLength(
          0
        );
        expect(written(events, 'delete:')).toHaveLength(0);
        expect(events).not.toContain('redeployServices');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('does not refuse when ai-worker raw PREVIOUS equals its CURRENT while the gateway has no PREVIOUS', async () => {
      const { deps, events } = makeHarness({
        vars: {
          'api-gateway': { API_KEY_ENCRYPTION_KEY: KEY_A_HEX },
          'ai-worker': {
            API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
            API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_A_HEX,
          },
        },
      });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        await expect(stageByokWindow(deps)).resolves.toBeUndefined();

        expect(events).toContain('upsert:api-gateway:API_KEY_ENCRYPTION_KEY_PREVIOUS');
        expect(events).toContain('upsert:api-gateway:API_KEY_ENCRYPTION_KEY');
        expect(events).toContain('redeployServices');
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('prepare decisions', () => {
    async function nextAfterRun(vars: VarStore): Promise<{ promoted: string; staged: string }> {
      const { deps, store } = makeHarness({ vars });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await stageByokWindow(deps);
      } finally {
        logSpy.mockRestore();
      }
      const staged = (vi.mocked(deps.upsertVariable).mock.calls[0][0] as { value: string }).value;
      return { promoted: store['api-gateway']?.API_KEY_ENCRYPTION_KEY ?? '', staged };
    }

    it('generates a fresh key when NEXT is unset', async () => {
      const { promoted, staged } = await nextAfterRun(
        sameVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX })
      );

      expect(staged).toMatch(/^[0-9a-f]{64}$/);
      expect(staged).not.toBe(KEY_A_HEX);
      expect(promoted).toBe(staged);
    });

    it('reuses a valid NEXT that is equal on both services and differs from CURRENT', async () => {
      const { promoted, staged } = await nextAfterRun(
        sameVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX, API_KEY_ENCRYPTION_KEY_NEXT: KEY_C_HEX })
      );

      expect(staged).toBe(KEY_C_HEX);
      expect(promoted).toBe(KEY_C_HEX);
    });

    it('generates a fresh key when NEXT is set on one service only', async () => {
      const { promoted, staged } = await nextAfterRun({
        'api-gateway': {
          API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
          API_KEY_ENCRYPTION_KEY_NEXT: KEY_C_HEX,
        },
        'ai-worker': { API_KEY_ENCRYPTION_KEY: KEY_A_HEX },
      });

      expect(staged).not.toBe(KEY_C_HEX);
      expect(staged).toMatch(/^[0-9a-f]{64}$/);
      expect(promoted).toBe(staged);
    });

    it('generates a fresh key when NEXT differs between the services', async () => {
      const { staged } = await nextAfterRun({
        'api-gateway': {
          API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
          API_KEY_ENCRYPTION_KEY_NEXT: KEY_C_HEX,
        },
        'ai-worker': { API_KEY_ENCRYPTION_KEY: KEY_A_HEX, API_KEY_ENCRYPTION_KEY_NEXT: KEY_D_HEX },
      });

      expect(staged).not.toBe(KEY_C_HEX);
      expect(staged).not.toBe(KEY_D_HEX);
    });

    it('generates a fresh key when NEXT equals CURRENT on both services', async () => {
      const { staged } = await nextAfterRun(
        sameVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX, API_KEY_ENCRYPTION_KEY_NEXT: KEY_A_HEX })
      );

      expect(staged).not.toBe(KEY_A_HEX);
      expect(staged).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates a fresh key when an equal-on-both NEXT is malformed', async () => {
      const malformed = 'not-hex-material';
      const { staged } = await nextAfterRun(
        sameVars({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX, API_KEY_ENCRYPTION_KEY_NEXT: malformed })
      );

      expect(staged).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('no key value in any failure message or console line', () => {
    afterEach(() => vi.restoreAllMocks());

    it.each([
      'upsert:ai-worker:API_KEY_ENCRYPTION_KEY_NEXT',
      'upsert:ai-worker:API_KEY_ENCRYPTION_KEY_PREVIOUS',
      'upsert:ai-worker:API_KEY_ENCRYPTION_KEY',
      'delete:ai-worker:API_KEY_ENCRYPTION_KEY_NEXT',
    ])('fails closed at %s without leaking', async failAt => {
      const { deps, events } = makeHarness({ failOn: [failAt] });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const error = await stageByokWindow(deps).then(
        () => undefined,
        (e: unknown) => e as Error
      );

      expect(error).toBeInstanceOf(Error);
      expect(error?.message).not.toMatch(HEX64);
      expect(error?.cause).toBeUndefined();
      expect(logSpy.mock.calls.flat().map(String).join('\n')).not.toMatch(HEX64);
      expect(events).not.toContain('redeployServices');
    });
  });

  describe('pre-swap check: only the new deployment may be live', () => {
    /** Every write after the NEXT staging, i.e. the swap writes and any NEXT delete. */
    function writesAfterStaging(events: string[]): string[] {
      return events.filter(
        event => /^(upsert|delete):/.test(event) && !event.endsWith(':API_KEY_ENCRYPTION_KEY_NEXT')
      );
    }

    it('refuses the swap when ai-worker has an older live deployment, and writes no swap key', async () => {
      const { deps, events } = makeHarness({
        liveDeployments: { 'ai-worker': ['new-ai-worker', 'old-ai-worker'] },
      });

      const error = await stageByokWindow(deps).then(
        () => undefined,
        (e: unknown) => e as Error
      );

      expect(error?.message).toContain('ai-worker');
      expect(error?.message).toContain('old-ai-worker');
      expect(error?.message).toContain('has not changed and no row has been touched');
      expect(error?.message).not.toMatch(HEX64);
      expect(writesAfterStaging(events)).toEqual([]);
      expect(events).not.toContain('redeployServices');
    });

    it('refuses the swap when api-gateway has an older live deployment, and writes no swap key', async () => {
      const { deps, events } = makeHarness({
        liveDeployments: { 'api-gateway': ['new-api-gateway', 'old-api-gateway'] },
      });

      const error = await stageByokWindow(deps).then(
        () => undefined,
        (e: unknown) => e as Error
      );

      expect(error?.message).toContain('api-gateway');
      expect(error?.message).toContain('old-api-gateway');
      expect(writesAfterStaging(events)).toEqual([]);
      expect(events).not.toContain('redeployServices');
    });

    it.each([
      ['an empty list', []],
      ['a list without the new deployment', ['old-ai-worker']],
    ])('refuses the swap on %s for ai-worker', async (_label, liveIds) => {
      const { deps, events } = makeHarness({ liveDeployments: { 'ai-worker': liveIds } });

      await expect(stageByokWindow(deps)).rejects.toThrow(/ai-worker/);
      expect(writesAfterStaging(events)).toEqual([]);
      expect(events).not.toContain('redeployServices');
    });

    it('proceeds when each service live list is exactly its own new deployment, and asks each service by its own ids', async () => {
      const { deps, events } = makeHarness();

      await stageByokWindow(deps);

      expect(deps.listLiveDeploymentIds).toHaveBeenCalledTimes(2);
      expect(deps.listLiveDeploymentIds).toHaveBeenCalledWith({
        serviceId: 'svc-api-gateway',
        environmentId: 'envid',
        env: 'dev',
      });
      expect(deps.listLiveDeploymentIds).toHaveBeenCalledWith({
        serviceId: 'svc-ai-worker',
        environmentId: 'envid',
        env: 'dev',
      });
      expect(written(events, 'upsert:ai-worker:API_KEY_ENCRYPTION_KEY_PREVIOUS')).toHaveLength(1);
      expect(events).toContain('redeployServices');
    });

    it('refuses before the swap when listing the live deployments throws, and writes no swap key', async () => {
      const { deps, events } = makeHarness();
      vi.mocked(deps.listLiveDeploymentIds).mockRejectedValueOnce(
        new Error('Railway API unreachable')
      );

      await expect(stageByokWindow(deps)).rejects.toThrow(
        /Could not list the live deployments of api-gateway \(dev\) before the swap/
      );
      expect(writesAfterStaging(events)).toEqual([]);
      expect(events).not.toContain('redeployServices');
    });

    it('refuses when the redeploy result does not name the deployment it superseded, and writes no swap key', async () => {
      const { deps, events } = makeHarness();
      vi.mocked(deps.redeployWithSource).mockResolvedValueOnce({
        newDeploymentId: 'new-api-gateway',
      } as unknown as Awaited<ReturnType<StageByokWindowDeps['redeployWithSource']>>);

      await expect(stageByokWindow(deps)).rejects.toThrow(
        /did not report the deployment it superseded/
      );
      expect(writesAfterStaging(events)).toEqual([]);
      expect(events).not.toContain('redeployServices');
    });

    it('refuses when the redeploy result does not name its new deployment, and writes no swap key', async () => {
      const { deps, events } = makeHarness();
      vi.mocked(deps.redeployWithSource).mockResolvedValueOnce({
        sourceDeploymentId: 'old-api-gateway',
      } as unknown as Awaited<ReturnType<StageByokWindowDeps['redeployWithSource']>>);
      // Only the redeploy step runs here: the real wait would first throw its own
      // "supersedes ours" error for a missing new id, so the stage's guard is what is tested.
      vi.mocked(deps.redeployAndWait).mockImplementationOnce(async args => {
        await args.redeploy?.({
          environmentId: args.environmentId,
          serviceId: args.service.id,
          serviceName: args.service.name,
          env: args.env,
        });
        return 'unused';
      });

      await expect(stageByokWindow(deps)).rejects.toThrow(/did not report its new deployment/);
      expect(writesAfterStaging(events)).toEqual([]);
      expect(events).not.toContain('redeployServices');
    });
  });

  describe('image decrypt gate (refuse before the first write when a running image ignores NEXT)', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    it('checks each service twice with its ids and env; the first pair precedes any write', async () => {
      const { deps, events } = makeHarness();

      await stageByokWindow(deps);

      // Twice per service: before the first write, and again before the swap.
      expect(deps.checkDeployedCode).toHaveBeenCalledTimes(4);
      expect(deps.checkDeployedCode).toHaveBeenCalledWith({
        environmentId: 'envid',
        serviceId: 'svc-api-gateway',
        serviceName: 'api-gateway',
        env: 'dev',
      });
      expect(deps.checkDeployedCode).toHaveBeenCalledWith({
        environmentId: 'envid',
        serviceId: 'svc-ai-worker',
        serviceName: 'ai-worker',
        env: 'dev',
      });
      // The first pair runs before the first write; the second pair runs before the swap.
      const firstWrite = Math.min(...written(events, 'upsert:'));
      const gateIndexes = written(events, 'gate:');
      expect(gateIndexes).toHaveLength(4);
      expect(gateIndexes.slice(0, 2).every(index => index < firstWrite)).toBe(true);
      // The second pair runs after the last old deployment is drained and before the first swap write.
      const lastRemovalPoll = Math.max(...written(events, 'status:old-'));
      const firstPrevious = events.indexOf('upsert:api-gateway:API_KEY_ENCRYPTION_KEY_PREVIOUS');
      expect(
        gateIndexes.slice(2).every(index => index > lastRemovalPoll && index < firstPrevious)
      ).toBe(true);
    });

    it('refuses before the swap when ai-worker changes image between the first check and the redeploy', async () => {
      // Calls 0-1 (before any write) pass; call 3 (ai-worker, before the swap) fails.
      const { deps, events, store } = makeHarness({
        imageGateSequence: [
          undefined,
          undefined,
          undefined,
          {
            'ai-worker': {
              ok: false,
              reason: 'rolled back to an image without NEXT',
              // The gate read the deployment and refused its image, so the id is known.
              deploymentId: 'new-ai-worker',
            },
          },
        ],
      });
      const before = structuredClone(store);

      const error = await stageByokWindow(deps).then(
        () => undefined,
        (caught: unknown) => caught
      );

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('ai-worker: rolled back to an image without NEXT');
      expect(message).toContain(
        'API_KEY_ENCRYPTION_KEY has not changed and no row has been touched; the staged API_KEY_ENCRYPTION_KEY_NEXT is harmless'
      );
      expect(message).toContain('re-run BYOK stage 1 (it reuses API_KEY_ENCRYPTION_KEY_NEXT).');
      // Both gate pairs ran, and the redeploys happened before the refusal.
      expect(written(events, 'gate:')).toHaveLength(4);
      expect(events).toContain('redeploy:ai-worker');
      // No PREVIOUS or CURRENT write and no delete; CURRENT is unchanged.
      expect(events.filter(e => /^upsert:.*:API_KEY_ENCRYPTION_KEY(_PREVIOUS)?$/.test(e))).toEqual(
        []
      );
      expect(events.filter(e => e.startsWith('delete:'))).toEqual([]);
      expect(store).toEqual({
        'api-gateway': {
          ...before['api-gateway'],
          API_KEY_ENCRYPTION_KEY_NEXT: expect.any(String),
        },
        'ai-worker': { ...before['ai-worker'], API_KEY_ENCRYPTION_KEY_NEXT: expect.any(String) },
      });
      expect(store['api-gateway'].API_KEY_ENCRYPTION_KEY).toBe(KEY_A_HEX);
      expect(store['ai-worker'].API_KEY_ENCRYPTION_KEY).toBe(KEY_A_HEX);

      // Re-run on the same store with the gate passing: stage 1 reuses the NEXT the
      // refused run staged, and promotes it to CURRENT on both services.
      const stagedNext = store['api-gateway'].API_KEY_ENCRYPTION_KEY_NEXT;
      expect(stagedNext).toMatch(/^[0-9a-f]{64}$/);
      const rerunLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await expect(stageByokWindow(deps)).resolves.toBeUndefined();
        const logged = rerunLog.mock.calls.map(call => String(call[0])).join('\n');
        expect(logged).toContain(
          'reusing the staged API_KEY_ENCRYPTION_KEY_NEXT found on both services (dev)'
        );
      } finally {
        rerunLog.mockRestore();
      }
      expect(store['api-gateway'].API_KEY_ENCRYPTION_KEY).toBe(stagedNext);
      expect(store['ai-worker'].API_KEY_ENCRYPTION_KEY).toBe(stagedNext);
    });

    it('refuses before the swap when the pre-swap gate read a different deployment than this run created', async () => {
      // The commit may still match, but the deployment read is not the one stage 1 redeployed.
      const { deps, events, store } = makeHarness({
        imageGateSequence: [
          undefined,
          undefined,
          {
            'api-gateway': {
              ok: true,
              commit: 'c0ffee0000000000000000000000000000000000',
              deploymentId: 'dep-a-newer-deploy',
            },
          },
        ],
      });
      const before = structuredClone(store);

      const error = await stageByokWindow(deps).then(
        () => undefined,
        (caught: unknown) => caught
      );

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain(
        'api-gateway: the deployment it read (dep-a-newer-deploy) is not the one this run created (new-api-gateway); a newer deploy landed after the redeploy'
      );
      // A mismatch is not a stale image, so the tail does not advise deploying NEXT-aware code.
      expect(
        message.endsWith(
          "API_KEY_ENCRYPTION_KEY has not changed and no row has been touched; the staged API_KEY_ENCRYPTION_KEY_NEXT is harmless (nothing encrypts with it). A newer deploy landed after this run's redeploy: wait for it to settle, then re-run BYOK stage 1 (it reuses API_KEY_ENCRYPTION_KEY_NEXT)."
        )
      ).toBe(true);
      expect(message).not.toContain('Deploy code with the NEXT-aware decrypt');
      // Nothing past NEXT is written: no PREVIOUS or CURRENT upsert, no delete.
      expect(events.filter(e => /^upsert:.*:API_KEY_ENCRYPTION_KEY(_PREVIOUS)?$/.test(e))).toEqual(
        []
      );
      expect(events.filter(e => e.startsWith('delete:'))).toEqual([]);
      expect(store['api-gateway'].API_KEY_ENCRYPTION_KEY).toBe(
        before['api-gateway'].API_KEY_ENCRYPTION_KEY
      );
      expect(store['ai-worker'].API_KEY_ENCRYPTION_KEY).toBe(
        before['ai-worker'].API_KEY_ENCRYPTION_KEY
      );
    });

    it('refuses before the swap, prefixing the read failure, when the pre-swap live deployment cannot be read', async () => {
      // No deploymentId on the result means the read itself failed (a newer deploy may still be in flight).
      const { deps, events } = makeHarness({
        imageGateSequence: [
          undefined,
          undefined,
          undefined,
          {
            'ai-worker': {
              ok: false,
              reason: 'could not read the live deployment for "ai-worker": timeout',
            },
          },
        ],
      });

      const error = await stageByokWindow(deps).then(
        () => undefined,
        (caught: unknown) => caught
      );

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain(
        'ai-worker: the live deployment could not be read (a newer deploy may still be in flight; wait for it to settle and re-run): could not read the live deployment for "ai-worker": timeout. '
      );
      // Not all failures are mismatches, so the stale-image tail is kept.
      expect(message).toContain('Deploy code with the NEXT-aware decrypt');
      expect(events.filter(e => e.startsWith('delete:'))).toEqual([]);
    });

    it("reports the gate's own reason, not the mismatch message, when the pre-swap result is not ok but carries a deploymentId", async () => {
      const { deps, events } = makeHarness({
        imageGateSequence: [
          undefined,
          undefined,
          undefined,
          {
            'ai-worker': {
              ok: false,
              reason: 'carries no "API_KEY_ENCRYPTION_KEY_PREVIOUS"',
              deploymentId: 'new-ai-worker',
            },
          },
        ],
      });

      const error = await stageByokWindow(deps).then(
        () => undefined,
        (caught: unknown) => caught
      );

      const message = (error as Error).message;
      expect(message).toContain('ai-worker: carries no "API_KEY_ENCRYPTION_KEY_PREVIOUS"');
      expect(message).not.toContain('is not the one this run created');
      expect(message).not.toContain('could not be read');
      expect(events.filter(e => e.startsWith('delete:'))).toEqual([]);
    });

    it('refuses before any write when ai-worker runs an image that ignores NEXT', async () => {
      const { deps, events, store } = makeHarness({
        imageGate: { 'ai-worker': { ok: false, reason: 'stale image' } },
      });
      const before = structuredClone(store);

      await expect(stageByokWindow(deps)).rejects.toThrow(/ai-worker[\s\S]*stale image/);

      expect(events.filter(e => /^(upsert|delete|redeploy)/.test(e))).toEqual([]);
      expect(store).toEqual(before);
    });

    it('names every service whose image fails the gate', async () => {
      const { deps } = makeHarness({
        imageGate: {
          'api-gateway': { ok: false, reason: 'gateway stale' },
          'ai-worker': { ok: false, reason: 'worker stale' },
        },
      });

      const error = await stageByokWindow(deps).then(
        () => undefined,
        (caught: unknown) => caught
      );

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('api-gateway: gateway stale');
      expect(message).toContain('ai-worker: worker stale');
      expect(message).toContain('API_KEY_ENCRYPTION_KEY has not changed and nothing was written.');
      expect(deps.upsertVariable).not.toHaveBeenCalled();
    });
  });
});
