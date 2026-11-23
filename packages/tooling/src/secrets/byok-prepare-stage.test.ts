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
}

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
        'upsert:api-gateway:API_KEY_ENCRYPTION_KEY_NEXT',
        'upsert:ai-worker:API_KEY_ENCRYPTION_KEY_NEXT',
        'redeploy:api-gateway',
        'latest:api-gateway',
        'status:old-api-gateway:REMOVED',
        'redeploy:ai-worker',
        'latest:ai-worker',
        'status:old-ai-worker:REMOVED',
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
});
