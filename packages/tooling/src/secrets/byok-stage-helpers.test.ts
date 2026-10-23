/**
 * Tests for stage-1 BYOK helpers and repair message builders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertByokServicesDeploymentReady,
  redeployCommands,
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
      'Failed to upsert API_KEY_ENCRYPTION_KEY on api-gateway (dev); it may or may not have applied. Re-run stage 1, then follow what it reports: if it completes, nothing more to do; if it reports API_KEY_ENCRYPTION_KEY DIFFERS, copy API_KEY_ENCRYPTION_KEY from api-gateway to ai-worker in the Railway dashboard, then run `pnpm ops deploy:redeploy --env dev --service api-gateway --yes` and the same for ai-worker, wait for both, then run stage 2; if it reports a rotation window is already open, every write landed: redeploy both services the same way, wait for both, then run stage 2. No stored row has been touched; stage 2 has not run.'
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
      'Failed to upsert API_KEY_ENCRYPTION_KEY on ai-worker (prod); it may or may not have applied. Re-run stage 1, then follow what it reports: if it completes, nothing more to do; if it reports API_KEY_ENCRYPTION_KEY DIFFERS, copy API_KEY_ENCRYPTION_KEY from api-gateway to ai-worker in the Railway dashboard, then run `pnpm ops deploy:redeploy --env prod --service api-gateway --yes` and the same for ai-worker, wait for both, then run stage 2; if it reports a rotation window is already open, every write landed: redeploy both services the same way, wait for both, then run stage 2. No stored row has been touched; stage 2 has not run.'
    );
    expect(err.cause).toBeUndefined();
  });
});

describe('redeployCommands', () => {
  it('builds one deploy:redeploy command per service, joined by "; "', () => {
    expect(redeployCommands('api-gateway, ai-worker', 'prod')).toBe(
      '`pnpm ops deploy:redeploy --env prod --service api-gateway --yes`; `pnpm ops deploy:redeploy --env prod --service ai-worker --yes`'
    );
  });

  it('builds a single command for a single service with no joiner', () => {
    expect(redeployCommands('api-gateway', 'dev')).toBe(
      '`pnpm ops deploy:redeploy --env dev --service api-gateway --yes`'
    );
  });
});

describe('stageRedeployFailureMessage', () => {
  it('names the deploy:redeploy command per failed service, drops the dashboard hedge, and keeps "then run stage 2"', () => {
    const singleMsg = stageRedeployFailureMessage('api-gateway', 'dev');

    expect(singleMsg).toContain('`pnpm ops deploy:redeploy --env dev --service api-gateway --yes`');
    expect(singleMsg).toContain('then run stage 2.');
    expect(singleMsg).toContain('wait for each redeploy to reach SUCCESS, then run stage 2.');
    expect(singleMsg).not.toContain('not verified:');
    expect(singleMsg).not.toContain('Railway dashboard');

    const bothMsg = stageRedeployFailureMessage('api-gateway, ai-worker', 'prod');
    expect(bothMsg).toContain('`pnpm ops deploy:redeploy --env prod --service api-gateway --yes`');
    expect(bothMsg).toContain('`pnpm ops deploy:redeploy --env prod --service ai-worker --yes`');
    expect(bothMsg).toContain('then run stage 2.');
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
