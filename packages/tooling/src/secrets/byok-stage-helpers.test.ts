/**
 * Tests for stage-1 BYOK helpers and repair message builders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
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
  it('instructs to re-run stage 1 when the first PREVIOUS write fails', () => {
    const err = stageUpsertFailureError({
      env: 'dev',
      phase: 'previous',
      failedService: 'api-gateway',
    });

    expect(err.message).toContain('Nothing was written. Re-run stage 1.');
    expect(err.message.endsWith('No stored row has been touched; stage 2 has not run.')).toBe(true);
    expect(err.cause).toBeUndefined();
  });

  it('prints the var-delete command for the first service when the second PREVIOUS write fails', () => {
    const err = stageUpsertFailureError({
      env: 'dev',
      phase: 'previous',
      failedService: 'ai-worker',
      okService: 'api-gateway',
    });

    expect(err.message).toContain(
      'PREVIOUS was written on api-gateway only. Delete it there with `pnpm ops deploy:var-delete --env dev --service api-gateway --name API_KEY_ENCRYPTION_KEY_PREVIOUS --yes`, then re-run stage 1.'
    );
    expect(err.message.endsWith('No stored row has been touched; stage 2 has not run.')).toBe(true);
    expect(err.cause).toBeUndefined();
  });

  it('describes the degenerate window and instructs to re-run stage 1 when the first CURRENT write fails', () => {
    const err = stageUpsertFailureError({
      env: 'dev',
      phase: 'current',
      failedService: 'api-gateway',
    });

    expect(err.message).toContain(
      'Both services hold the old key as PREVIOUS and CURRENT (a degenerate window). Re-run stage 1.'
    );
    expect(err.message.endsWith('No stored row has been touched; stage 2 has not run.')).toBe(true);
    expect(err.cause).toBeUndefined();
  });

  it('instructs to copy API_KEY_ENCRYPTION_KEY in the dashboard when the second CURRENT write fails', () => {
    const err = stageUpsertFailureError({
      env: 'dev',
      phase: 'current',
      failedService: 'ai-worker',
      okService: 'api-gateway',
    });

    expect(err.message).toContain(
      'api-gateway now has the new API_KEY_ENCRYPTION_KEY, ai-worker still has the old one; both have the old key as PREVIOUS. In the Railway dashboard, copy API_KEY_ENCRYPTION_KEY from api-gateway to ai-worker, redeploy both services, then run stage 2.'
    );
    expect(err.message.endsWith('No stored row has been touched; stage 2 has not run.')).toBe(true);
    expect(err.cause).toBeUndefined();
  });
});

describe('stageRedeployFailureMessage', () => {
  it('names the failed service, dashboard redeploy path, and unverified variable-snapshot caveat', () => {
    const msg = stageRedeployFailureMessage('api-gateway');

    expect(msg).toContain(
      "Redeploy api-gateway (Railway dashboard: the service's latest deployment → Redeploy), then run stage 2."
    );
    expect(msg).toContain(
      "(not verified: that a dashboard redeploy carries the just-written variables; check the new deployment's start time is after this run)"
    );
  });
});

describe('stageByokWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRailwayApiToken.mockReturnValue('tok');
  });

  it('writes PREVIOUS on both services before CURRENT on both services, then redeploys', async () => {
    const upsertVariable = vi.fn().mockResolvedValue(undefined);
    const redeployServices = vi.fn().mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await stageByokWindow({
        env: 'dev',
        getServiceVariable: () => KEY_A_HEX,
        getServiceVariableOrEmpty: () => '',
        resolveByokIds: () => MOCK_IDS,
        upsertVariable,
        redeployServices,
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
      expect(redeployServices).toHaveBeenCalledWith('dev', MOCK_IDS, stageRedeployFailureMessage);
    } finally {
      logSpy.mockRestore();
    }
  });
});
