import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./railway-api.js', () => ({
  requireRailwayApiToken: vi.fn(),
  assertRailwayServiceDeploymentReady: vi.fn(),
  redeployRailwayServiceReusingImage: vi.fn(),
}));

vi.mock('./railway-status.js', () => ({
  resolveRailwayIds: vi.fn(),
}));

vi.mock('../utils/confirm.js', () => ({
  confirmPrompt: vi.fn(),
}));

import {
  requireRailwayApiToken,
  assertRailwayServiceDeploymentReady,
  redeployRailwayServiceReusingImage,
} from './railway-api.js';
import { resolveRailwayIds } from './railway-status.js';
import { confirmPrompt } from '../utils/confirm.js';
import { runRedeployService, type RedeployServiceOptions } from './redeploy-service.js';

const mockRequireToken = vi.mocked(requireRailwayApiToken);
const mockAssertReady = vi.mocked(assertRailwayServiceDeploymentReady);
const mockRedeploy = vi.mocked(redeployRailwayServiceReusingImage);
const mockResolveIds = vi.mocked(resolveRailwayIds);
const mockConfirm = vi.mocked(confirmPrompt);

const BASE_OPTIONS: RedeployServiceOptions = {
  env: 'dev',
  service: 'api-gateway',
  dryRun: false,
  yes: true,
};

describe('runRedeployService', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRequireToken.mockReset();
    mockAssertReady.mockReset();
    mockRedeploy.mockReset();
    mockResolveIds.mockReset();
    mockConfirm.mockReset();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    mockRequireToken.mockReturnValue('tok-SENTINEL-do-not-leak');
    mockResolveIds.mockReturnValue({
      projectId: 'proj-1',
      environmentId: 'env-1',
      serviceId: 'svc-1',
    });
    mockAssertReady.mockResolvedValue(undefined);
    mockRedeploy.mockResolvedValue('dep-new-123');
    mockConfirm.mockResolvedValue(true);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves ids by service name and forwards exactly { environmentId, serviceId, env } to the redeploy', async () => {
    await runRedeployService(BASE_OPTIONS);

    expect(mockResolveIds).toHaveBeenCalledWith('dev', 'api-gateway');
    expect(mockAssertReady).toHaveBeenCalledWith({
      environmentId: 'env-1',
      serviceId: 'svc-1',
      serviceName: 'api-gateway',
      env: 'dev',
    });
    expect(mockRedeploy).toHaveBeenCalledTimes(1);
    const redeployArg = mockRedeploy.mock.calls[0]?.[0];
    expect(redeployArg).toEqual({
      environmentId: 'env-1',
      serviceId: 'svc-1',
      serviceName: 'api-gateway',
      env: 'dev',
    });
    expect(Object.hasOwn(redeployArg as object, 'projectId')).toBe(false);

    const allOutput = logSpy.mock.calls.flat().map(String).join('\n');
    expect(allOutput).toContain('dep-new-123');
  });

  it('refuses when the service is not ready and makes no redeploy call', async () => {
    mockAssertReady.mockRejectedValueOnce(
      new Error(
        "api-gateway's latest deployment is INITIALIZING, not SUCCESS — wait for it to settle (or fix it), then re-run. Nothing was changed."
      )
    );

    await expect(runRedeployService(BASE_OPTIONS)).rejects.toThrow(
      "api-gateway's latest deployment is INITIALIZING, not SUCCESS"
    );
    expect(mockRedeploy).not.toHaveBeenCalled();
  });

  it('--dry-run makes no API call', async () => {
    await runRedeployService({ ...BASE_OPTIONS, dryRun: true });

    expect(mockResolveIds).toHaveBeenCalledWith('dev', 'api-gateway');
    expect(mockAssertReady).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('--yes skips the confirmation prompt (including on prod)', async () => {
    await runRedeployService({ ...BASE_OPTIONS, env: 'prod', yes: true });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockRedeploy).toHaveBeenCalledWith({
      environmentId: 'env-1',
      serviceId: 'svc-1',
      serviceName: 'api-gateway',
      env: 'prod',
    });
  });

  it('prompts when --yes is false and aborts without calling the API when declined', async () => {
    mockConfirm.mockResolvedValue(false);

    await runRedeployService({ ...BASE_OPTIONS, yes: false });

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockAssertReady).not.toHaveBeenCalled();
    expect(mockRedeploy).not.toHaveBeenCalled();
  });

  it('rejects with the token error and never calls resolveRailwayIds', async () => {
    mockRequireToken.mockImplementation(() => {
      throw new Error('missing token');
    });

    await expect(runRedeployService(BASE_OPTIONS)).rejects.toThrow('missing token');
    expect(mockResolveIds).not.toHaveBeenCalled();
  });

  it('never leaks the token via console output', async () => {
    await runRedeployService({ ...BASE_OPTIONS, dryRun: true });
    await runRedeployService({ ...BASE_OPTIONS, dryRun: false, yes: true });

    for (const spy of [logSpy, errorSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain('tok-SENTINEL-do-not-leak');
        }
      }
    }
  });
});
