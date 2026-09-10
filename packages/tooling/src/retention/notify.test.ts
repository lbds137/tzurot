import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  retentionNotifyMock,
  retentionRunBeginMock,
  retentionRunEndMock,
  getClientMock,
  confirmMock,
} = vi.hoisted(() => ({
  retentionNotifyMock: vi.fn(),
  retentionRunBeginMock: vi.fn(),
  retentionRunEndMock: vi.fn(),
  getClientMock: vi.fn(),
  confirmMock: vi.fn(),
}));

vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
  requireProductionConfirmation: confirmMock,
}));
vi.mock('../utils/gateway-client.js', () => ({ resolveServiceClientOrExit: getClientMock }));

import { retentionNotify, renderNotifyRun } from './notify.js';

const RUN_ID = '3f2b8c1e-9d4a-4c5b-8e7f-1a2b3c4d5e6f';

function runResult(overrides: Partial<Parameters<typeof renderNotifyRun>[0]> = {}) {
  return {
    status: 'dry_run' as const,
    cohortSize: 2,
    userbaseCount: 100,
    percentOfUserbase: 2,
    breakerWarning: false,
    batchesEnqueued: 0,
    recipients: [
      { discordId: '900000000000000001', inactiveSince: '2025-01-01T00:00:00.000Z' },
      { discordId: '900000000000000002', inactiveSince: '2025-02-01T00:00:00.000Z' },
    ],
    ...overrides,
  };
}

describe('retentionNotify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getClientMock.mockReturnValue({
      retentionNotify: retentionNotifyMock,
      retentionRunBegin: retentionRunBeginMock,
      retentionRunEnd: retentionRunEndMock,
    });
    retentionRunBeginMock.mockResolvedValue({
      ok: true,
      data: { runId: RUN_ID, leaseTtlMs: 600000 },
    });
    retentionRunEndMock.mockResolvedValue({ ok: true, data: { released: true } });
    confirmMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dry-run resolves the cohort and never enqueues', async () => {
    retentionNotifyMock.mockResolvedValue({ ok: true, data: runResult() });

    await retentionNotify({ env: 'prod', dryRun: true });

    expect(retentionNotifyMock).toHaveBeenCalledTimes(1);
    expect(retentionNotifyMock).toHaveBeenCalledWith({ dryRun: true });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(retentionRunBeginMock).not.toHaveBeenCalled();
  });

  it('a real prod run previews first, confirms, then enqueues with runContext AND the leased runId', async () => {
    retentionNotifyMock
      .mockResolvedValueOnce({ ok: true, data: runResult() })
      .mockResolvedValueOnce({
        ok: true,
        data: runResult({ status: 'enqueued', batchesEnqueued: 1 }),
      });

    await retentionNotify({ env: 'prod' });

    // The confirmation names the action and the count — the operator vouches
    // for exactly what the dry-run just showed them.
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('2 inactive users'));
    expect(retentionNotifyMock).toHaveBeenNthCalledWith(2, {
      breakerOverride: false,
      runContext: 'ops retention:notify (prod)',
      runId: RUN_ID,
    });
  });

  it('begins the lease AFTER the confirmation, and never on a dry run or an empty cohort', async () => {
    retentionNotifyMock
      .mockResolvedValueOnce({ ok: true, data: runResult() })
      .mockResolvedValueOnce({
        ok: true,
        data: runResult({ status: 'enqueued', batchesEnqueued: 1 }),
      });

    await retentionNotify({ env: 'prod' });

    expect(confirmMock.mock.invocationCallOrder[0]).toBeLessThan(
      retentionRunBeginMock.mock.invocationCallOrder[0]
    );
  });

  it('a declined confirmation enqueues nothing, and never takes the lease', async () => {
    // The real gate exits the process on decline (it never returns declined);
    // the mock simulates that non-return by rejecting with a sentinel.
    retentionNotifyMock.mockResolvedValue({ ok: true, data: runResult() });
    confirmMock.mockRejectedValue(new Error('exit: declined'));

    await expect(retentionNotify({ env: 'prod' })).rejects.toThrow('exit: declined');

    expect(retentionNotifyMock).toHaveBeenCalledTimes(1);
    expect(retentionRunBeginMock).not.toHaveBeenCalled();
  });

  it('requires confirmation on DEV too, and enqueues nothing when declined', async () => {
    // Dev is not a sandbox for this command either: dev mirrors prod's users
    // via sync, so a dev run DMs real people and starts their grace clocks.
    retentionNotifyMock.mockResolvedValue({ ok: true, data: runResult() });
    confirmMock.mockRejectedValue(new Error('exit: declined'));

    await expect(retentionNotify({ env: 'dev' })).rejects.toThrow('exit: declined');

    expect(confirmMock).toHaveBeenCalled();
    expect(retentionNotifyMock).toHaveBeenCalledTimes(1);
  });

  it('spells out the mirrored-userbase consequence before the dev prompt', async () => {
    const logSpy = vi.mocked(console.log);
    retentionNotifyMock
      .mockResolvedValueOnce({ ok: true, data: runResult() })
      .mockResolvedValueOnce({
        ok: true,
        data: runResult({ status: 'enqueued', batchesEnqueued: 1 }),
      });

    await retentionNotify({ env: 'dev' });

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('NOT A SANDBOX OPERATION');
    expect(output).toContain('DMs REAL users');
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('via DEV'));
  });

  it('prompts on LOCAL too, without asserting a sync consequence that does not exist', async () => {
    // local reads its own ambient env and is not part of the dev<->prod sync;
    // it still gets the gate, but not the mirrored-userbase banner.
    const logSpy = vi.mocked(console.log);
    retentionNotifyMock
      .mockResolvedValueOnce({ ok: true, data: runResult() })
      .mockResolvedValueOnce({
        ok: true,
        data: runResult({ status: 'enqueued', batchesEnqueued: 1 }),
      });

    await retentionNotify({ env: 'local' });

    expect(confirmMock).toHaveBeenCalledWith(expect.not.stringContaining('mirrored prod userbase'));
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).not.toContain('NOT A SANDBOX OPERATION');
  });

  it('--force skips the prompt on dev as well (it asserts the operator, not the env)', async () => {
    retentionNotifyMock
      .mockResolvedValueOnce({ ok: true, data: runResult() })
      .mockResolvedValueOnce({
        ok: true,
        data: runResult({ status: 'enqueued', batchesEnqueued: 1 }),
      });

    await retentionNotify({ env: 'dev', force: true });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(retentionNotifyMock).toHaveBeenCalledTimes(2);
  });

  it('an empty cohort stops before the confirmation and never takes the lease', async () => {
    retentionNotifyMock.mockResolvedValue({
      ok: true,
      data: runResult({ status: 'empty', cohortSize: 0, recipients: [] }),
    });

    await retentionNotify({ env: 'prod' });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(retentionNotifyMock).toHaveBeenCalledTimes(1);
    expect(retentionRunBeginMock).not.toHaveBeenCalled();
  });

  it('a refused preview stops BEFORE the confirmation and never takes the lease', async () => {
    // The service runs the hard-ceiling breaker before its dry-run branch, so
    // the PREVIEW call itself comes back refused for an over-ceiling cohort.
    retentionNotifyMock.mockResolvedValue({
      ok: true,
      data: runResult({ status: 'refused_breaker', breakerDetail: 'too big' }),
    });

    await retentionNotify({ env: 'prod' });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(retentionNotifyMock).toHaveBeenCalledTimes(1);
    expect(retentionRunBeginMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('--breaker-override proceeds past a refused preview to confirm + the real leased run', async () => {
    retentionNotifyMock
      .mockResolvedValueOnce({
        ok: true,
        data: runResult({ status: 'refused_breaker', breakerDetail: 'too big' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        data: runResult({ status: 'enqueued', batchesEnqueued: 1 }),
      });

    await retentionNotify({ env: 'prod', breakerOverride: true });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(retentionNotifyMock).toHaveBeenNthCalledWith(2, {
      breakerOverride: true,
      runContext: 'ops retention:notify (prod)',
      runId: RUN_ID,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('a gateway failure exits non-zero instead of reading as an empty cohort', async () => {
    retentionNotifyMock.mockResolvedValue({
      ok: false,
      kind: 'http',
      error: 'Unauthorized',
      status: 401,
    });

    await retentionNotify({ env: 'dev' });

    expect(process.exitCode).toBe(1);
  });

  it('begin refused (RUN_IN_PROGRESS) — the real notify call is never made, exitCode 1', async () => {
    retentionNotifyMock.mockResolvedValue({ ok: true, data: runResult() });
    retentionRunBeginMock.mockResolvedValue({
      ok: false,
      kind: 'http',
      error: 'Another retention run is in progress: "other run" (since 2026-01-01).',
      code: 'RUN_IN_PROGRESS',
    });

    await retentionNotify({ env: 'prod' });

    // Only the dry-run preview call happened; the real (leased) call never did.
    expect(retentionNotifyMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });

  it('end is called with the runId after a normal successful run', async () => {
    retentionNotifyMock
      .mockResolvedValueOnce({ ok: true, data: runResult() })
      .mockResolvedValueOnce({
        ok: true,
        data: runResult({ status: 'enqueued', batchesEnqueued: 1 }),
      });

    await retentionNotify({ env: 'prod' });

    expect(retentionRunEndMock).toHaveBeenCalledWith({ runId: RUN_ID });
  });

  it('end is called with the runId even when the real notify call rejects', async () => {
    retentionNotifyMock
      .mockResolvedValueOnce({ ok: true, data: runResult() })
      .mockRejectedValueOnce(new Error('gateway exploded'));

    await expect(retentionNotify({ env: 'prod' })).rejects.toThrow('gateway exploded');

    expect(retentionRunEndMock).toHaveBeenCalledWith({ runId: RUN_ID });
  });
});

describe('renderNotifyRun', () => {
  it('prints the warn annotation with first-run context when flagged', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    renderNotifyRun(runResult({ breakerWarning: true, percentOfUserbase: 18.7 }));

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Breaker warning');
    expect(output).toContain('FIRST');
    logSpy.mockRestore();
  });
});
