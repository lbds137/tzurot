import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { previewMock, purgeMock, reconcileMock, getClientMock, confirmMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  purgeMock: vi.fn(),
  reconcileMock: vi.fn(),
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

function cohort(...discordIds: string[]) {
  return {
    users: discordIds.map(discordId => ({
      discordId,
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
    });
    reconcileMock.mockResolvedValue({ ok: true, data: { settled: 0, stillFailing: 0 } });
    confirmMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('purges every cohort member, one call each', async () => {
    previewMock.mockResolvedValue({
      ok: true,
      data: cohort('900000000000000001', '900000000000000002'),
    });
    purgeMock.mockImplementation(({ discordId }: { discordId: string }) =>
      Promise.resolve(PURGED(discordId))
    );

    await retentionPurge({ env: 'dev' });

    expect(purgeMock).toHaveBeenCalledTimes(2);
    expect(purgeMock.mock.calls[0][0]).toMatchObject({ discordId: '900000000000000001' });
    expect(purgeMock.mock.calls[1][0]).toMatchObject({ discordId: '900000000000000002' });
  });

  it('DRY RUN reports the cohort and purges nothing', async () => {
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });

    await retentionPurge({ env: 'prod', dryRun: true });

    expect(purgeMock).not.toHaveBeenCalled();
    // A dry run must not even ask for approval — there is nothing to approve.
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('requires production confirmation, and purges nothing when declined', async () => {
    // The real gate exits the process on decline (it never returns declined);
    // the mock simulates that non-return by rejecting with a sentinel.
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    confirmMock.mockRejectedValue(new Error('exit: declined'));

    await expect(retentionPurge({ env: 'prod' })).rejects.toThrow('exit: declined');

    expect(confirmMock).toHaveBeenCalled();
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it('--force skips the prompt', async () => {
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    purgeMock.mockResolvedValue(PURGED('900000000000000001'));

    await retentionPurge({ env: 'prod', force: true });

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

  it('drains the off-DB retry queue after the loop', async () => {
    previewMock.mockResolvedValue({ ok: true, data: cohort('900000000000000001') });
    purgeMock.mockResolvedValue(PURGED('900000000000000001'));

    await retentionPurge({ env: 'dev' });

    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing (and does not prompt) when the cohort is empty', async () => {
    previewMock.mockResolvedValue({
      ok: true,
      data: { users: [], totals: cohort().totals },
    });

    await retentionPurge({ env: 'prod' });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(purgeMock).not.toHaveBeenCalled();
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
});
