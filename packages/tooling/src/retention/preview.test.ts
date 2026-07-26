import { describe, it, expect, vi, beforeEach } from 'vitest';

const { retentionPreviewMock, getClientMock } = vi.hoisted(() => ({
  retentionPreviewMock: vi.fn(),
  getClientMock: vi.fn(),
}));

vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
}));
vi.mock('../utils/gateway-client.js', () => ({ resolveServiceClientOrExit: getClientMock }));

import { retentionPreview, renderPreview } from './preview.js';

const EMPTY_TOTALS = {
  eligibleCount: 0,
  userbaseCount: 100,
  percentOfUserbase: 0,
  charactersToDelete: 0,
  charactersToReHome: 0,
  breakerWarning: false,
  reachableToNotify: 0,
  inGrace: 0,
  graceExpired: 0,
};

const COHORT = {
  users: [
    {
      discordId: '900000000000000001',
      inactiveSince: '2025-01-01T00:00:00.000Z',
      reason: 'unreachable' as const,
      ownedCharacters: { toDelete: 1, toReHome: 2 },
    },
    {
      discordId: '900000000000000002',
      inactiveSince: '2025-02-01T00:00:00.000Z',
      reason: 'account_gone' as const,
      ownedCharacters: { toDelete: 0, toReHome: 0 },
    },
  ],
  totals: {
    eligibleCount: 2,
    userbaseCount: 20,
    percentOfUserbase: 10,
    charactersToDelete: 1,
    charactersToReHome: 2,
    breakerWarning: false,
    reachableToNotify: 0,
    inGrace: 0,
    graceExpired: 0,
  },
};

describe('retentionPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    getClientMock.mockReturnValue({ retentionPreview: retentionPreviewMock });
  });

  it('fetches the cohort from the gateway for the requested env', async () => {
    retentionPreviewMock.mockResolvedValue({ ok: true, data: { users: [], totals: EMPTY_TOTALS } });

    await retentionPreview({ env: 'prod' });

    // The env crosses the seam into the client factory, and the command reads
    // the cohort from the gateway (never a local re-derivation of the predicate).
    expect(getClientMock).toHaveBeenCalledWith('prod');
    expect(retentionPreviewMock).toHaveBeenCalledOnce();
    expect(process.exitCode).toBeUndefined();
  });

  it('stops cleanly when credentials can not be resolved', async () => {
    // Railway CLI not logged in / missing variable. The shared resolver owns
    // reporting and the exit code (see gateway-client.test.ts); the command's
    // job is to stop rather than proceed without a client — and to RESOLVE, not
    // reject, so this surfaces as a friendly exit and not a crash.
    getClientMock.mockReturnValue(null);

    await expect(retentionPreview({ env: 'prod' })).resolves.toBeUndefined();

    expect(retentionPreviewMock).not.toHaveBeenCalled();
  });

  it('exits non-zero on a gateway failure instead of reporting an empty cohort', async () => {
    // Silent-empty on failure would read as "nobody is eligible" — the most
    // dangerous possible misreport for a purge preview.
    retentionPreviewMock.mockResolvedValue({
      ok: false,
      kind: 'http',
      error: 'Unauthorized',
      status: 401,
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await retentionPreview({ env: 'dev' });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unauthorized'));
    errorSpy.mockRestore();
  });
});

describe('renderPreview', () => {
  it('reports the empty cohort as the healthy state', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    renderPreview({ users: [], totals: EMPTY_TOTALS });

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('No users are purge-eligible');
    // All pipeline counts zero → no reachable-branch line to render.
    expect(output).not.toContain('reachable branch');
    logSpy.mockRestore();
  });

  it('prints the reachable-branch line whenever ANY pipeline count is non-zero', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    // graceExpired-only is a real steady state: those users have left the
    // other two counts (window passed, already warned) — a guard on only the
    // two upstream counts would drop the line exactly when it matters.
    renderPreview({
      ...COHORT,
      totals: { ...COHORT.totals, graceExpired: 2 },
    });

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain(
      'reachable branch: 0 awaiting a warning DM, 0 in grace, 2 grace-expired'
    );
    logSpy.mockRestore();
  });

  it('prints each user, both reasons, and the character split', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    renderPreview(COHORT);

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('900000000000000001');
    expect(output).toContain('900000000000000002');
    expect(output).toContain('Discord account deleted');
    expect(output).toContain('2 would be re-homed');
    expect(output).toContain('Read-only');
    logSpy.mockRestore();
  });

  it('surfaces the breaker warning with the percentage', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    renderPreview({
      ...COHORT,
      totals: { ...COHORT.totals, percentOfUserbase: 40, breakerWarning: true },
    });

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Circuit-breaker warning');
    expect(output).toContain('40%');
    logSpy.mockRestore();
  });
});
