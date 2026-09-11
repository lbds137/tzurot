import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  previewMock,
  purgeMock,
  reconcileMock,
  retentionRunBeginMock,
  retentionRunEndMock,
  getClientMock,
  confirmMock,
} = vi.hoisted(() => ({
  previewMock: vi.fn(),
  purgeMock: vi.fn(),
  reconcileMock: vi.fn(),
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

import { retentionPurge, parseExcludes } from './purge.js';

const RUN_ID = '3f2b8c1e-9d4a-4c5b-8e7f-1a2b3c4d5e6f';

function cohort(...discordIds: string[]) {
  return {
    users: discordIds.map(discordId => ({
      discordId,
      username: `user${discordId.slice(-2)}`,
      inactiveSince: '2025-01-01T00:00:00.000Z',
      reason: 'unreachable' as const,
      ownedCharacters: { toDelete: 1, toReHome: 0 },
    })),
    totals: {
      eligibleCount: discordIds.length,
      userbaseCount: 100,
      percentOfUserbase: discordIds.length,
      charactersToDelete: discordIds.length,
      charactersToReHome: 0,
      breakerWarning: false,
      reachableToNotify: 0,
      inGrace: 0,
      graceExpired: 0,
      bystander: 0,
      reminderDue: 0,
      scope: { kind: 'unrestricted' as const, excludedEligibleCount: 0 },
    },
  };
}

const PURGED = (discordId: string) => ({
  ok: true as const,
  data: { status: 'purged' as const, discordId, charactersDeleted: 1, charactersReHomed: 0 },
});

describe('parseExcludes', () => {
  it('splits, trims, and drops empties', () => {
    expect(parseExcludes(' a , b ,, c ')).toEqual(new Set(['a', 'b', 'c']));
  });

  it('treats absent or blank input as no exclusions', () => {
    expect(parseExcludes(undefined)).toEqual(new Set());
    expect(parseExcludes('   ')).toEqual(new Set());
  });
});

describe('retentionPurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getClientMock.mockReturnValue({
      retentionPreview: previewMock,
      retentionPurge: purgeMock,
      retentionReconcileOffDb: reconcileMock,
      retentionRunBegin: retentionRunBeginMock,
      retentionRunEnd: retentionRunEndMock,
    });
    reconcileMock.mockResolvedValue({
      ok: true,
      data: { settled: 0, stillFailing: 0, remaining: 0 },
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
    process.removeAllListeners('SIGINT');
  });

  it('purges every cohort member, one call each, carrying the leased runId', async () => {
    previewMock.mockResolvedValue({
      ok: true,
      data: cohort('900000000000000001', '900000000000000002'),
    });
    purgeMock.mockImplementation(({ discordId }: { discordId: string }) =>
      Promise.resolve(PURGED(discordId))
    );

    await retentionPurge({ env: 'dev' });

    expect(purgeMock).toHaveBeenCalledTimes(2);
    expect(purgeMock.mock.calls[0][0]).toMatchObject({
      discordId: '900000000000000001',
      runId: RUN_ID,
    });
    expect(purgeMock.mock.calls[1][0]).toMatchObject({
      discordId: '900000000000000002',
      runId: RUN_ID,
    });
  });

  it('DRY RUN reports the cohort and purges nothing, never taking the lease', async () => {
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });

    await retentionPurge({ env: 'prod', dryRun: true });

    expect(purgeMock).not.toHaveBeenCalled();
    // A dry run must not even ask for approval — there is nothing to approve.
    expect(confirmMock).not.toHaveBeenCalled();
    expect(retentionRunBeginMock).not.toHaveBeenCalled();
  });

  it('requires production confirmation, and purges nothing when declined', async () => {
    // The real gate exits the process on decline (it never returns declined);
    // the mock simulates that non-return by rejecting with a sentinel.
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    confirmMock.mockRejectedValue(new Error('exit: declined'));

    await expect(retentionPurge({ env: 'prod' })).rejects.toThrow('exit: declined');

    expect(confirmMock).toHaveBeenCalled();
    expect(purgeMock).not.toHaveBeenCalled();
    expect(retentionRunBeginMock).not.toHaveBeenCalled();
  });

  it('requires confirmation on DEV too, and purges nothing when declined', async () => {
    // Dev is not a sandbox for this command: `users` is sync-tracked, so a dev
    // purge's tombstones erase the same accounts from prod on the next sync.
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    confirmMock.mockRejectedValue(new Error('exit: declined'));

    await expect(retentionPurge({ env: 'dev' })).rejects.toThrow('exit: declined');

    expect(confirmMock).toHaveBeenCalled();
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it('spells out the dev->prod sync consequence before the dev prompt', async () => {
    // The shared gate's banner only names PRODUCTION; on a dev run the reason
    // this is still a production erasure has to be stated, or the operator
    // reads the prompt as boilerplate.
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    purgeMock.mockResolvedValue(PURGED('900000000000000001'));
    const logSpy = vi.mocked(console.log);

    await retentionPurge({ env: 'dev' });

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('NOT A SANDBOX OPERATION');
    expect(output).toContain('sync-tracked');
    expect(output).toContain('propagate to PROD on the next sync');
  });

  it('prompts on LOCAL too, without asserting a sync consequence that does not exist', async () => {
    // local is not part of the dev<->prod sync — it still gets the gate, but
    // the sync banner there would be a fabricated consequence that trains the
    // operator to discount the warning.
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    purgeMock.mockResolvedValue(PURGED('900000000000000001'));
    const logSpy = vi.mocked(console.log);

    await retentionPurge({ env: 'local' });

    expect(confirmMock).toHaveBeenCalledWith(expect.not.stringContaining('propagating by sync'));
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).not.toContain('NOT A SANDBOX OPERATION');
  });

  it('--force skips the prompt', async () => {
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    purgeMock.mockResolvedValue(PURGED('900000000000000001'));

    await retentionPurge({ env: 'prod', force: true });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(purgeMock).toHaveBeenCalledTimes(1);
  });

  it('--force skips the prompt on dev as well (it asserts the operator, not the env)', async () => {
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    purgeMock.mockResolvedValue(PURGED('900000000000000001'));

    await retentionPurge({ env: 'dev', force: true });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(purgeMock).toHaveBeenCalledTimes(1);
  });

  it('--force does NOT imply the breaker override', async () => {
    // The two flags answer different questions: --force asserts the operator is
    // present; only --breaker-override asserts an implausible cohort is real.
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    purgeMock.mockResolvedValue(PURGED('900000000000000001'));

    await retentionPurge({ env: 'prod', force: true });

    expect(purgeMock.mock.calls[0][0].breakerOverride).toBe(false);
  });

  it('forwards --breaker-override when given', async () => {
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    purgeMock.mockResolvedValue(PURGED('900000000000000001'));

    await retentionPurge({ env: 'dev', breakerOverride: true });

    expect(purgeMock.mock.calls[0][0].breakerOverride).toBe(true);
  });

  it('skips excluded ids without calling the endpoint for them', async () => {
    previewMock.mockResolvedValue({
      ok: true,
      data: cohort('900000000000000001', '900000000000000002'),
    });
    purgeMock.mockResolvedValue(PURGED('900000000000000002'));

    await retentionPurge({ env: 'dev', exclude: '900000000000000001' });

    expect(purgeMock).toHaveBeenCalledTimes(1);
    expect(purgeMock.mock.calls[0][0].discordId).toBe('900000000000000002');
  });

  it('STOPS the run on a tripped breaker instead of retrying every member', async () => {
    previewMock.mockResolvedValue({
      ok: true,
      data: cohort('900000000000000001', '900000000000000002', '900000000000000003'),
    });
    purgeMock.mockResolvedValue({
      ok: true,
      data: {
        status: 'skipped',
        discordId: '900000000000000001',
        reason: 'breaker_tripped',
        detail: 'Circuit breaker: 30 of 100 users (30%).',
      },
    });

    await retentionPurge({ env: 'dev' });

    // Every subsequent call would trip identically; continuing would just
    // reprint the same refusal once per cohort member.
    expect(purgeMock).toHaveBeenCalledTimes(1);
  });

  it('STOPS the run on an unscoped_non_production skip too (every later call refuses identically)', async () => {
    previewMock.mockResolvedValue({
      ok: true,
      data: cohort('900000000000000001', '900000000000000002'),
    });
    purgeMock.mockResolvedValue({
      ok: true,
      data: {
        status: 'skipped',
        discordId: '900000000000000001',
        reason: 'unscoped_non_production',
      },
    });

    await retentionPurge({ env: 'dev' });

    expect(purgeMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT stop on an outside_allowlist skip — that is per-target, not per-run', async () => {
    previewMock.mockResolvedValue({
      ok: true,
      data: cohort('900000000000000001', '900000000000000002'),
    });
    purgeMock
      .mockResolvedValueOnce({
        ok: true,
        data: { status: 'skipped', discordId: '900000000000000001', reason: 'outside_allowlist' },
      })
      .mockResolvedValueOnce(PURGED('900000000000000002'));

    await retentionPurge({ env: 'dev' });

    expect(purgeMock).toHaveBeenCalledTimes(2);
  });

  it('keeps going past a per-user failure so one bad row cannot strand the rest', async () => {
    previewMock.mockResolvedValue({
      ok: true,
      data: cohort('900000000000000001', '900000000000000002'),
    });
    purgeMock
      .mockResolvedValueOnce({ ok: false, kind: 'server_error', error: 'boom' })
      .mockResolvedValueOnce(PURGED('900000000000000002'));

    await retentionPurge({ env: 'dev' });

    expect(purgeMock).toHaveBeenCalledTimes(2);
  });

  it('a lease-lost result STOPS the run without retrying, and still releases the lease', async () => {
    previewMock.mockResolvedValue({
      ok: true,
      data: cohort('900000000000000001', '900000000000000002'),
    });
    purgeMock.mockResolvedValue({
      ok: false,
      kind: 'http',
      error: 'This run no longer holds the retention run lease.',
      status: 409,
      code: 'RUN_LEASE_CONFLICT',
    });

    await retentionPurge({ env: 'dev' });

    expect(purgeMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    expect(retentionRunEndMock).toHaveBeenCalledWith({ runId: RUN_ID });
  });

  it('drains the off-DB retry queue after the loop', async () => {
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    purgeMock.mockResolvedValue(PURGED('900000000000000001'));

    await retentionPurge({ env: 'dev' });

    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces off-DB rows the bounded reconcile did not attempt', async () => {
    // The endpoint sweeps one batch; a bigger backlog must be reported, not
    // silently under-drained (it self-heals next run, but say so).
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    purgeMock.mockResolvedValue(PURGED('900000000000000001'));
    reconcileMock.mockResolvedValue({
      ok: true,
      data: { settled: 50, stillFailing: 0, remaining: 30 },
    });
    const logSpy = vi.mocked(console.log);

    await retentionPurge({ env: 'dev' });

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('not attempted: 30');
    expect(output).toContain('reconcile-off-db');
  });

  it('does nothing (and does not prompt) when the cohort is empty', async () => {
    previewMock.mockResolvedValue({
      ok: true,
      data: { users: [], totals: cohort().totals },
    });

    await retentionPurge({ env: 'prod' });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(purgeMock).not.toHaveBeenCalled();
    expect(retentionRunBeginMock).not.toHaveBeenCalled();
  });

  it('exits nonzero and purges nothing when the preview fetch fails', async () => {
    previewMock.mockResolvedValue({ ok: false, kind: 'network', error: 'unreachable' });

    await retentionPurge({ env: 'prod' });

    expect(process.exitCode).toBe(1);
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it('stops before any gateway call when credentials cannot be resolved', async () => {
    // The shared resolver reports and sets the exit code itself (covered in
    // gateway-client.test.ts); what matters here is that the command halts
    // rather than proceeding with no client.
    getClientMock.mockReturnValue(null);

    await retentionPurge({ env: 'prod' });

    expect(previewMock).not.toHaveBeenCalled();
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it('begins the run lease AFTER the confirmation', async () => {
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    purgeMock.mockResolvedValue(PURGED('900000000000000001'));

    await retentionPurge({ env: 'prod' });

    expect(confirmMock.mock.invocationCallOrder[0]).toBeLessThan(
      retentionRunBeginMock.mock.invocationCallOrder[0]
    );
  });

  it('begin refused (RUN_IN_PROGRESS) — retentionPurge is never called, exitCode 1', async () => {
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    retentionRunBeginMock.mockResolvedValue({
      ok: false,
      kind: 'http',
      error: 'Another retention run is in progress: "other run" (since 2026-01-01).',
      code: 'RUN_IN_PROGRESS',
    });

    await retentionPurge({ env: 'prod' });

    expect(purgeMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('end is called with the runId after a normal run', async () => {
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    purgeMock.mockResolvedValue(PURGED('900000000000000001'));

    await retentionPurge({ env: 'dev' });

    expect(retentionRunEndMock).toHaveBeenCalledWith({ runId: RUN_ID });
  });

  it('end is called with the runId even when retentionPurge REJECTS mid-loop', async () => {
    previewMock.mockResolvedValue({
      ok: true,
      data: cohort('900000000000000001', '900000000000000002'),
    });
    purgeMock.mockRejectedValueOnce(new Error('transport exploded'));

    await expect(retentionPurge({ env: 'dev' })).rejects.toThrow('transport exploded');

    expect(retentionRunEndMock).toHaveBeenCalledWith({ runId: RUN_ID });
  });

  it('SIGINT stops the loop, releases the lease, and exits 130 without a second purge call', async () => {
    previewMock.mockResolvedValue({
      ok: true,
      data: cohort('900000000000000001', '900000000000000002'),
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    purgeMock.mockImplementationOnce(() => {
      process.emit('SIGINT');
      return Promise.resolve(PURGED('900000000000000001'));
    });

    await retentionPurge({ env: 'dev' });
    // Let the handler's fire-and-forget release/exit chain settle before
    // counting calls — it is not awaited by retentionPurge itself.
    await new Promise(resolve => setImmediate(resolve));

    expect(purgeMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(130);
    expect(retentionRunEndMock).toHaveBeenCalledWith({ runId: RUN_ID });
    // The HANDLER's own release must precede the exit: in a real process the
    // exit ends everything, so the command's finally would never get to run.
    expect(retentionRunEndMock.mock.invocationCallOrder[0]).toBeLessThan(
      exitSpy.mock.invocationCallOrder[0]
    );
    // Exactly one release for the whole interrupted run: the command's own
    // finally must not release a second time on top of the handler's.
    expect(retentionRunEndMock).toHaveBeenCalledTimes(1);
  });
});
