/**
 * Tests for stage-1 BYOK helpers and repair message builders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RailwayRedeployRefusedError } from '../deployment/railway-api.js';
import {
  assertByokServicesDeploymentReady,
  finalizeRedeployFailureMessage,
  stageUpsertFailureError,
  stageRedeployFailureMessage,
  stageByokWindow,
  type ByokServiceIds,
} from './byok-stage-helpers.js';

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

const MOCK_IDS: ByokServiceIds = {
  'api-gateway': {
    projectId: 'proj',
    environmentId: 'envid',
    serviceId: 'svc-api-gateway',
  },
  'ai-worker': {
    projectId: 'proj',
    environmentId: 'envid',
    serviceId: 'svc-ai-worker',
  },
};

describe('stageUpsertFailureError', () => {
  it('instructs to re-run stage 1 with honest may-or-may-not-have-applied wording when the first PREVIOUS write fails', () => {
    const err = stageUpsertFailureError({
      env: 'dev',
      phase: 'previous',
      failedService: 'api-gateway',
    });

    expect(err.message).toBe(
      'Failed to upsert API_KEY_ENCRYPTION_KEY_PREVIOUS on api-gateway (dev); it may or may not have applied. Re-run stage 1. No stored row has been touched; stage 2 has not run.'
    );
    expect(err.cause).toBeUndefined();
  });

  it('instructs to re-run stage 1 with honest may-or-may-not-have-applied wording when the second PREVIOUS write fails', () => {
    const err = stageUpsertFailureError({
      env: 'dev',
      phase: 'previous',
      failedService: 'ai-worker',
    });

    expect(err.message).toBe(
      'Failed to upsert API_KEY_ENCRYPTION_KEY_PREVIOUS on ai-worker (dev); it may or may not have applied. Re-run stage 1. No stored row has been touched; stage 2 has not run.'
    );
    expect(err.cause).toBeUndefined();
  });

  it('instructs to re-run stage 1 and follow what it reports when the first CURRENT write fails', () => {
    const err = stageUpsertFailureError({
      env: 'dev',
      phase: 'current',
      failedService: 'api-gateway',
    });

    expect(err.message).toBe(
      'Failed to upsert API_KEY_ENCRYPTION_KEY on api-gateway (dev); it may or may not have applied. Re-run stage 1, then follow what it reports: if it completes, nothing more to do; if it reports API_KEY_ENCRYPTION_KEY DIFFERS, copy API_KEY_ENCRYPTION_KEY from api-gateway to ai-worker in the Railway dashboard, then run stage 2, which redeploys both services itself and waits for each to reach SUCCESS; if it reports a rotation window is already open, every write landed: run stage 2, which redeploys both services itself. No stored row has been touched; stage 2 has not run.'
    );
    expect(err.cause).toBeUndefined();
  });

  it('instructs to re-run stage 1 and follow what it reports when the second CURRENT write fails', () => {
    const err = stageUpsertFailureError({
      env: 'prod',
      phase: 'current',
      failedService: 'ai-worker',
    });

    expect(err.message).toBe(
      'Failed to upsert API_KEY_ENCRYPTION_KEY on ai-worker (prod); it may or may not have applied. Re-run stage 1, then follow what it reports: if it completes, nothing more to do; if it reports API_KEY_ENCRYPTION_KEY DIFFERS, copy API_KEY_ENCRYPTION_KEY from api-gateway to ai-worker in the Railway dashboard, then run stage 2, which redeploys both services itself and waits for each to reach SUCCESS; if it reports a rotation window is already open, every write landed: run stage 2, which redeploys both services itself. No stored row has been touched; stage 2 has not run.'
    );
    expect(err.cause).toBeUndefined();
  });
});

describe('finalizeRedeployFailureMessage', () => {
  const LEDGER = 'stamp the ledger: `pnpm ops secrets:mark-rotated byok-encryption-key --env dev`.';
  const REFUSED_TAIL =
    ': the redeploy was refused because the latest deployment is not SUCCESS — wait for it to settle, or fix it in the Railway dashboard, then redeploy it with ';
  const cmd = (svc: string): string =>
    `\`pnpm ops deploy:redeploy --env dev --service ${svc} --yes\``;

  it('with no refusal, keeps the plain redeploy-with-commands text and the ledger sentence', () => {
    expect(
      finalizeRedeployFailureMessage({
        env: 'dev',
        failures: [
          { name: 'api-gateway', error: new Error('boom') },
          { name: 'ai-worker', error: new Error('boom') },
        ],
      })
    ).toBe(
      `API_KEY_ENCRYPTION_KEY_PREVIOUS is deleted from Railway, but api-gateway, ai-worker still hold it in memory until they restart. Redeploy api-gateway, ai-worker with ${cmd('api-gateway')}; ${cmd('ai-worker')}, wait for each redeploy to reach SUCCESS, then ${LEDGER}`
    );
  });

  it('with every failure refused, sends them to the dashboard with the command only as the retry', () => {
    const message = finalizeRedeployFailureMessage({
      env: 'dev',
      failures: [{ name: 'ai-worker', error: new RailwayRedeployRefusedError('not SUCCESS') }],
    });

    expect(message).toBe(
      `API_KEY_ENCRYPTION_KEY_PREVIOUS is deleted from Railway, but ai-worker still holds it in memory until it restarts. ai-worker${REFUSED_TAIL}${cmd('ai-worker')}, wait for it to reach SUCCESS, then ${LEDGER}`
    );
    expect(message.indexOf('wait for it to reach SUCCESS')).toBeLessThan(
      message.indexOf('stamp the ledger')
    );
    expect(message).not.toContain('Redeploy ai-worker with');
    expect(message).not.toContain('if it still holds');
  });

  it('with a mix, gives the refused sentence first and then the plain redeploy for the rest', () => {
    expect(
      finalizeRedeployFailureMessage({
        env: 'dev',
        failures: [
          { name: 'api-gateway', error: new Error('boom') },
          { name: 'ai-worker', error: new RailwayRedeployRefusedError('not SUCCESS') },
        ],
      })
    ).toBe(
      `API_KEY_ENCRYPTION_KEY_PREVIOUS is deleted from Railway, but api-gateway, ai-worker still hold it in memory until they restart. ai-worker${REFUSED_TAIL}${cmd('ai-worker')}, wait for it to reach SUCCESS; for the rest: redeploy api-gateway with ${cmd('api-gateway')}, wait for each redeploy to reach SUCCESS, then ${LEDGER}`
    );
  });
});

describe('stageRedeployFailureMessage', () => {
  it('sends the operator to stage 2 (which redeploys itself) and names the dashboard fix, not a deploy:redeploy command, for a FAILED, CRASHED, REMOVED or SKIPPED latest deployment', () => {
    const singleMsg = stageRedeployFailureMessage('api-gateway');

    expect(singleMsg).toContain(
      "Run stage 2 once both services' latest deployments have settled: it redeploys both services itself and waits for each new deployment to reach SUCCESS before touching any row."
    );
    expect(singleMsg).toContain(
      "If a service's latest deployment is FAILED, CRASHED, REMOVED or SKIPPED, fix it in the Railway dashboard until its latest deployment is SUCCESS first, because stage 2's readiness check refuses it (`pnpm ops deploy:redeploy` refuses it too)."
    );
    expect(singleMsg).not.toContain('wait for each redeploy');
    expect(singleMsg).not.toContain('not verified:');
    expect(singleMsg).not.toContain('--service');

    const bothMsg = stageRedeployFailureMessage('api-gateway, ai-worker');
    expect(bothMsg).toContain('Run stage 2 once both services');
    expect(bothMsg).toContain('api-gateway, ai-worker failed to redeploy');
  });
});

describe('assertByokServicesDeploymentReady', () => {
  it('calls the passed assert fn once per BYOK service with ids, service name, and env', async () => {
    const assertFn = vi.fn().mockResolvedValue(undefined);

    await assertByokServicesDeploymentReady('dev', MOCK_IDS, assertFn);

    expect(assertFn).toHaveBeenCalledTimes(2);
    expect(assertFn).toHaveBeenNthCalledWith(1, {
      environmentId: 'envid',
      serviceId: 'svc-api-gateway',
      serviceName: 'api-gateway',
      env: 'dev',
    });
    expect(assertFn).toHaveBeenNthCalledWith(2, {
      environmentId: 'envid',
      serviceId: 'svc-ai-worker',
      serviceName: 'ai-worker',
      env: 'dev',
    });
  });

  it('stops at the first rejection — the second service is not checked', async () => {
    const assertFn = vi.fn().mockRejectedValue(new Error('api-gateway not ready'));

    await expect(assertByokServicesDeploymentReady('prod', MOCK_IDS, assertFn)).rejects.toThrow(
      'api-gateway not ready'
    );
    expect(assertFn).toHaveBeenCalledTimes(1);
  });
});

describe('stageByokWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRailwayApiToken.mockReturnValue('tok');
  });

  it('checks readiness for both services, writes PREVIOUS on both before CURRENT on both, prints one line per write, then redeploys', async () => {
    const assertServiceDeploymentReady = vi.fn().mockResolvedValue(undefined);
    const upsertVariable = vi.fn().mockResolvedValue(undefined);
    const redeployServices = vi.fn().mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await stageByokWindow({
        env: 'dev',
        getServiceVariable: () => KEY_A_HEX,
        getServiceVariableOrEmpty: () => '',
        resolveByokIds: () => MOCK_IDS,
        assertServiceDeploymentReady,
        upsertVariable,
        redeployServices,
      });

      expect(assertServiceDeploymentReady).toHaveBeenCalledTimes(2);
      expect(assertServiceDeploymentReady).toHaveBeenNthCalledWith(1, {
        environmentId: 'envid',
        serviceId: 'svc-api-gateway',
        serviceName: 'api-gateway',
        env: 'dev',
      });
      expect(assertServiceDeploymentReady).toHaveBeenNthCalledWith(2, {
        environmentId: 'envid',
        serviceId: 'svc-ai-worker',
        serviceName: 'ai-worker',
        env: 'dev',
      });

      expect(upsertVariable).toHaveBeenCalledTimes(4);
      expect(upsertVariable.mock.calls[0][0]).toMatchObject({
        serviceId: 'svc-api-gateway',
        name: 'API_KEY_ENCRYPTION_KEY_PREVIOUS',
        value: KEY_A_HEX,
      });
      expect(upsertVariable.mock.calls[1][0]).toMatchObject({
        serviceId: 'svc-ai-worker',
        name: 'API_KEY_ENCRYPTION_KEY_PREVIOUS',
        value: KEY_A_HEX,
      });
      expect(upsertVariable.mock.calls[2][0]).toMatchObject({
        serviceId: 'svc-api-gateway',
        name: 'API_KEY_ENCRYPTION_KEY',
      });
      expect(upsertVariable.mock.calls[3][0]).toMatchObject({
        serviceId: 'svc-ai-worker',
        name: 'API_KEY_ENCRYPTION_KEY',
      });
      expect(redeployServices).toHaveBeenCalledWith('dev', MOCK_IDS, expect.any(Function));

      const setLines = logSpy.mock.calls
        .map(call => String(call[0]))
        .filter(line => line.includes('  set '));
      expect(setLines).toHaveLength(4);
      expect(setLines[0]).toContain('  set API_KEY_ENCRYPTION_KEY_PREVIOUS on api-gateway (dev)');
      expect(setLines[1]).toContain('  set API_KEY_ENCRYPTION_KEY_PREVIOUS on ai-worker (dev)');
      expect(setLines[2]).toContain('  set API_KEY_ENCRYPTION_KEY on api-gateway (dev)');
      expect(setLines[3]).toContain('  set API_KEY_ENCRYPTION_KEY on ai-worker (dev)');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('refuses before any upsert when a service is not ready', async () => {
    const assertServiceDeploymentReady = vi.fn().mockImplementation(async ({ serviceName }) => {
      if (serviceName === 'ai-worker') {
        throw new Error(
          "ai-worker's latest deployment is INITIALIZING, not SUCCESS — wait for it to settle (or fix it), then re-run. Nothing was changed."
        );
      }
    });
    const upsertVariable = vi.fn().mockResolvedValue(undefined);
    const redeployServices = vi.fn().mockResolvedValue(undefined);

    await expect(
      stageByokWindow({
        env: 'dev',
        getServiceVariable: () => KEY_A_HEX,
        getServiceVariableOrEmpty: () => '',
        resolveByokIds: () => MOCK_IDS,
        assertServiceDeploymentReady,
        upsertVariable,
        redeployServices,
      })
    ).rejects.toThrow("ai-worker's latest deployment is INITIALIZING, not SUCCESS");

    expect(upsertVariable).not.toHaveBeenCalled();
    expect(redeployServices).not.toHaveBeenCalled();
  });
});
