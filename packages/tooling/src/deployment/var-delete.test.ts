import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./railway-api.js', () => ({
  requireRailwayApiToken: vi.fn(),
  deleteRailwayVariable: vi.fn(),
}));

vi.mock('./railway-status.js', () => ({
  resolveRailwayIds: vi.fn(),
}));

vi.mock('../utils/confirm.js', () => ({
  confirmPrompt: vi.fn(),
}));

import { requireRailwayApiToken, deleteRailwayVariable } from './railway-api.js';
import { resolveRailwayIds } from './railway-status.js';
import { confirmPrompt } from '../utils/confirm.js';
import { runVarDelete, type VarDeleteOptions } from './var-delete.js';

const mockRequireToken = vi.mocked(requireRailwayApiToken);
const mockDeleteVar = vi.mocked(deleteRailwayVariable);
const mockResolveIds = vi.mocked(resolveRailwayIds);
const mockConfirm = vi.mocked(confirmPrompt);

const BASE_OPTIONS: VarDeleteOptions = {
  env: 'dev',
  service: 'bot-client',
  name: 'SOME_KEY',
  dryRun: false,
  yes: true,
};

describe('runVarDelete', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRequireToken.mockReset();
    mockDeleteVar.mockReset();
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
    mockDeleteVar.mockResolvedValue(undefined);
    mockConfirm.mockResolvedValue(true);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('dry-run performs no delete and no fetch', async () => {
    await runVarDelete({ ...BASE_OPTIONS, dryRun: true });

    // A dry run still resolves ids, so it needs a linked, logged-in checkout.
    expect(mockResolveIds).toHaveBeenCalledTimes(1);
    expect(mockDeleteVar).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects with the token error and never calls resolveRailwayIds', async () => {
    const tokenError = new Error('missing token');
    mockRequireToken.mockImplementation(() => {
      throw tokenError;
    });

    await expect(runVarDelete(BASE_OPTIONS)).rejects.toThrow('missing token');
    expect(mockResolveIds).not.toHaveBeenCalled();
  });

  it('--yes skips the confirmation prompt and forwards exactly the four fields', async () => {
    await runVarDelete({ ...BASE_OPTIONS, yes: true });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockDeleteVar).toHaveBeenCalledWith({
      projectId: 'proj-1',
      environmentId: 'env-1',
      serviceId: 'svc-1',
      name: 'SOME_KEY',
    });
  });

  it('forwards no serviceId key for a shared-scope delete', async () => {
    mockResolveIds.mockReturnValue({ projectId: 'proj-1', environmentId: 'env-1' });

    await runVarDelete({ ...BASE_OPTIONS, service: null, yes: true });

    const arg = mockDeleteVar.mock.calls[0]?.[0];
    expect(arg).toBeDefined();
    expect(Object.hasOwn(arg as object, 'serviceId')).toBe(false);
  });

  it('does not delete when confirmation is declined', async () => {
    mockConfirm.mockResolvedValue(false);

    await runVarDelete({ ...BASE_OPTIONS, yes: false });

    expect(mockDeleteVar).not.toHaveBeenCalled();
  });

  it('never leaks the token via console output on dry-run or success', async () => {
    await runVarDelete({ ...BASE_OPTIONS, dryRun: true });
    await runVarDelete({ ...BASE_OPTIONS, dryRun: false, yes: true });

    for (const spy of [logSpy, errorSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain('tok-SENTINEL-do-not-leak');
        }
      }
    }
  });
});
