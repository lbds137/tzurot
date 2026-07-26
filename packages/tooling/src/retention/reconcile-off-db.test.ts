import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { reconcileMock, getClientMock } = vi.hoisted(() => ({
  reconcileMock: vi.fn(),
  getClientMock: vi.fn(),
}));

vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
}));
vi.mock('../utils/gateway-client.js', () => ({ resolveServiceClientOrExit: getClientMock }));

import { retentionReconcileOffDb } from './reconcile-off-db.js';

describe('retentionReconcileOffDb', () => {
  let logged: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    getClientMock.mockReturnValue({ retentionReconcileOffDb: reconcileMock });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports an empty queue as an explicit all-clear', async () => {
    reconcileMock.mockResolvedValue({ ok: true, data: { settled: 0, stillFailing: 0 } });

    await retentionReconcileOffDb({ env: 'dev' });

    expect(logged.join('\n')).toContain('Nothing owed');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports what it settled', async () => {
    reconcileMock.mockResolvedValue({ ok: true, data: { settled: 3, stillFailing: 0 } });

    await retentionReconcileOffDb({ env: 'dev' });

    expect(logged.join('\n')).toContain('3');
  });

  it('surfaces rows that are still failing rather than reporting success', async () => {
    reconcileMock.mockResolvedValue({ ok: true, data: { settled: 1, stillFailing: 2 } });

    await retentionReconcileOffDb({ env: 'prod' });

    expect(logged.join('\n')).toContain('still failing');
  });

  it('exits nonzero when the sweep call fails', async () => {
    reconcileMock.mockResolvedValue({ ok: false, kind: 'network', error: 'unreachable' });

    await retentionReconcileOffDb({ env: 'prod' });

    expect(process.exitCode).toBe(1);
  });

  it('stops before any gateway call when credentials cannot be resolved', async () => {
    getClientMock.mockReturnValue(null);

    await retentionReconcileOffDb({ env: 'prod' });

    expect(reconcileMock).not.toHaveBeenCalled();
  });
});
