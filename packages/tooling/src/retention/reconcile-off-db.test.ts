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
    reconcileMock.mockResolvedValue({
      ok: true,
      data: { settled: 0, stillFailing: 0, remaining: 0 },
    });

    await retentionReconcileOffDb({ env: 'dev' });

    expect(logged.join('\n')).toContain('Nothing owed');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports what it settled', async () => {
    reconcileMock.mockResolvedValue({
      ok: true,
      data: { settled: 3, stillFailing: 0, remaining: 0 },
    });

    await retentionReconcileOffDb({ env: 'dev' });

    expect(logged.join('\n')).toContain('3');
  });

  it('surfaces rows that are still failing rather than reporting success', async () => {
    reconcileMock.mockResolvedValue({
      ok: true,
      data: { settled: 1, stillFailing: 2, remaining: 0 },
    });

    await retentionReconcileOffDb({ env: 'prod' });

    expect(logged.join('\n')).toContain('still failing');
  });

  it('exits nonzero when the sweep call fails', async () => {
    reconcileMock.mockResolvedValue({ ok: false, kind: 'network', error: 'unreachable' });

    await retentionReconcileOffDb({ env: 'prod' });

    expect(process.exitCode).toBe(1);
  });

  it('loops batches while the endpoint reports unattempted rows, summing totals', async () => {
    // The endpoint sweeps one bounded batch per call; the CLI walks the queue.
    reconcileMock
      .mockResolvedValueOnce({ ok: true, data: { settled: 50, stillFailing: 0, remaining: 70 } })
      .mockResolvedValueOnce({ ok: true, data: { settled: 50, stillFailing: 0, remaining: 20 } })
      .mockResolvedValueOnce({ ok: true, data: { settled: 20, stillFailing: 0, remaining: 0 } });

    await retentionReconcileOffDb({ env: 'dev' });

    expect(reconcileMock).toHaveBeenCalledTimes(3);
    expect(logged.join('\n')).toContain('120');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports cap-exhaustion distinctly — no phantom "failures above" advice', async () => {
    // A >1000-row backlog with ZERO failures exhausts the per-run cap; the
    // message must say so instead of pointing at failures that don't exist.
    reconcileMock.mockResolvedValue({
      ok: true,
      data: { settled: 50, stillFailing: 0, remaining: 500 },
    });

    await retentionReconcileOffDb({ env: 'dev' });

    expect(reconcileMock).toHaveBeenCalledTimes(20); // MAX_BATCHES
    const output = logged.join('\n');
    expect(output).toContain('batch cap');
    expect(output).not.toContain('failures above');
    expect(process.exitCode).toBeUndefined();
  });

  it('stops looping on an in-batch failure and reports the unattempted rest', async () => {
    // Failed rows stay at the head of the queue — looping past a failing
    // batch would burn iterations re-attempting the same rows.
    reconcileMock.mockResolvedValue({
      ok: true,
      data: { settled: 10, stillFailing: 2, remaining: 40 },
    });

    await retentionReconcileOffDb({ env: 'prod' });

    expect(reconcileMock).toHaveBeenCalledTimes(1);
    const output = logged.join('\n');
    expect(output).toContain('still failing');
    expect(output).toContain('not attempted');
    expect(output).toContain('40');
  });

  it('stops before any gateway call when credentials cannot be resolved', async () => {
    getClientMock.mockReturnValue(null);

    await retentionReconcileOffDb({ env: 'prod' });

    expect(reconcileMock).not.toHaveBeenCalled();
  });
});
