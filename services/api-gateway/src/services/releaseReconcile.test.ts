import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { BroadcastCompletionSummary } from '@tzurot/common-types/schemas/api/broadcast';
import type { Queue } from 'bullmq';

const announceMock = vi.hoisted(() => vi.fn());
vi.mock('./releaseAnnounce.js', async () => {
  const actual =
    await vi.importActual<typeof import('./releaseAnnounce.js')>('./releaseAnnounce.js');
  return { ...actual, announceGitHubRelease: announceMock };
});

const addValidatedJobMock = vi.hoisted(() => vi.fn());
vi.mock('../utils/validatedQueue.js', () => ({
  addValidatedJob: addValidatedJobMock,
}));

const resolvePreviousDmsMock = vi.hoisted(() => vi.fn());
const computeCompletionSummaryMock = vi.hoisted(() => vi.fn());
vi.mock('./releaseBroadcast.js', async () => {
  const actual =
    await vi.importActual<typeof import('./releaseBroadcast.js')>('./releaseBroadcast.js');
  return {
    ...actual,
    resolvePreviousDms: resolvePreviousDmsMock,
    computeCompletionSummary: computeCompletionSummaryMock,
  };
});

import {
  createGitHubReleasesFetcher,
  reconcileReleaseAnnouncements,
  sweepIncompleteBroadcasts,
  MAX_ANNOUNCEMENTS_PER_RUN,
  MAX_RESWEEPS_PER_RUN,
  INCOMPLETE_WEDGE_THRESHOLD_MS,
  type FetchGitHubReleases,
} from './releaseReconcile.js';
import type { GitHubRelease } from './releaseAnnounce.js';

const NOW = new Date('2026-07-15T12:00:00Z');

const deps = { prisma: {} as PrismaClient, queue: {} as Queue };

function makeRelease(overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    id: 1,
    tag_name: 'v3.0.0-beta.166',
    name: null,
    body: '### Features\n- x',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.166',
    published_at: '2026-07-15T11:00:00Z',
    ...overrides,
  };
}

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

describe('reconcileReleaseAnnouncements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    announceMock.mockReset();
    announceMock.mockResolvedValue({
      status: 'announced',
      version: 'v',
      level: 'minor',
      recipients: 1,
      batches: 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function withReleases(releases: GitHubRelease[]): FetchGitHubReleases {
    return () => Promise.resolve(releases);
  }

  it('announces only releases inside the lookback window (23h in, 25h out)', async () => {
    const fresh = makeRelease({ id: 1, tag_name: 'v-fresh', published_at: hoursAgo(23) });
    const stale = makeRelease({ id: 2, tag_name: 'v-stale', published_at: hoursAgo(25) });
    const summary = await reconcileReleaseAnnouncements({
      ...deps,
      fetchReleases: withReleases([fresh, stale]),
    });
    expect(summary.checked).toBe(1);
    expect(announceMock).toHaveBeenCalledTimes(1);
    expect(announceMock.mock.calls[0][1].tag_name).toBe('v-fresh');
  });

  it('excludes null published_at (drafts) from the window entirely', async () => {
    const summary = await reconcileReleaseAnnouncements({
      ...deps,
      fetchReleases: withReleases([makeRelease({ published_at: null })]),
    });
    expect(summary.checked).toBe(0);
    expect(announceMock).not.toHaveBeenCalled();
  });

  it('announces a multi-release catch-up oldest-first', async () => {
    const newer = makeRelease({ id: 1, tag_name: 'v-newer', published_at: hoursAgo(1) });
    const older = makeRelease({ id: 2, tag_name: 'v-older', published_at: hoursAgo(5) });
    await reconcileReleaseAnnouncements(
      { ...deps, fetchReleases: withReleases([newer, older]) },
      { lookbackHours: 24 }
    );
    expect(announceMock.mock.calls.map(call => call[1].tag_name)).toEqual(['v-older', 'v-newer']);
  });

  it('counts already-announced and gate-skipped without announcing', async () => {
    announceMock
      .mockResolvedValueOnce({ status: 'already-announced', version: 'v-1' })
      .mockResolvedValueOnce({ status: 'skipped', version: 'v-2', reason: 'prerelease' });
    const summary = await reconcileReleaseAnnouncements({
      ...deps,
      fetchReleases: withReleases([
        makeRelease({ id: 1, tag_name: 'v-1', published_at: hoursAgo(2) }),
        makeRelease({ id: 2, tag_name: 'v-2', published_at: hoursAgo(1), prerelease: true }),
      ]),
    });
    expect(summary).toEqual({
      checked: 2,
      announced: [],
      alreadyAnnounced: 1,
      skipped: 1,
      capped: false,
    });
  });

  it('stops at the per-run cap with capped:true (history-blast insurance)', async () => {
    announceMock.mockImplementation((_deps, release: GitHubRelease) =>
      Promise.resolve({
        status: 'announced',
        version: release.tag_name,
        level: 'minor',
        recipients: 1,
        batches: 1,
      })
    );
    const releases = Array.from({ length: 6 }, (_, i) =>
      makeRelease({ id: i, tag_name: `v-${i}`, published_at: hoursAgo(i + 1) })
    );
    const summary = await reconcileReleaseAnnouncements(
      { ...deps, fetchReleases: withReleases(releases) },
      { lookbackHours: 24 }
    );
    expect(summary.announced).toHaveLength(MAX_ANNOUNCEMENTS_PER_RUN);
    expect(summary.capped).toBe(true);
    expect(announceMock).toHaveBeenCalledTimes(MAX_ANNOUNCEMENTS_PER_RUN);
  });
});

describe('sweepIncompleteBroadcasts', () => {
  const RELEASE_ID = '123e4567-e89b-42d3-a456-426614174000';
  const USER_A = '223e4567-e89b-42d3-a456-426614174000';
  const USER_B = '323e4567-e89b-42d3-a456-426614174000';

  function makePrisma(overrides: {
    wedged?: { id: string; version: string; body: string; level: string }[];
    totalRows?: number;
    pendingRows?: { id: string; userId: string; user: { discordId: string } }[];
    enabledUserIds?: string[];
  }) {
    return {
      releaseAnnouncement: {
        findMany: vi.fn().mockResolvedValue(overrides.wedged ?? []),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      releaseDeliveryLog: {
        count: vi.fn().mockResolvedValue(overrides.totalRows ?? 0),
        findMany: vi.fn().mockResolvedValue(overrides.pendingRows ?? []),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findMany: vi.fn().mockResolvedValue((overrides.enabledUserIds ?? []).map(id => ({ id }))),
      },
    };
  }

  const queue = {} as Queue;
  const wedgedAnnouncement = { id: RELEASE_ID, version: 'v-wedged', body: 'notes', level: 'minor' };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    addValidatedJobMock.mockReset().mockResolvedValue({ id: 'job' });
    resolvePreviousDmsMock.mockReset().mockResolvedValue(new Map());
    computeCompletionSummaryMock.mockReset().mockResolvedValue({
      version: 'v-wedged',
      sent: 4,
      failedPermanent: 1,
      failedTransient: 0,
      failedBotLevel: 0,
      optedOut: 0,
    } satisfies BroadcastCompletionSummary);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('scans only announcements older than the wedge threshold', async () => {
    const prisma = makePrisma({});
    await sweepIncompleteBroadcasts({ prisma: prisma as unknown as PrismaClient, queue });

    expect(prisma.releaseAnnouncement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          completedAt: null,
          createdAt: { lt: new Date(NOW.getTime() - INCOMPLETE_WEDGE_THRESHOLD_MS) },
        },
      })
    );
  });

  it('stamps a zero-row orphan complete without re-blasting (manual path only)', async () => {
    const prisma = makePrisma({ wedged: [wedgedAnnouncement], totalRows: 0, pendingRows: [] });
    const summary = await sweepIncompleteBroadcasts({
      prisma: prisma as unknown as PrismaClient,
      queue,
    });

    expect(summary.stamped).toEqual(['v-wedged']);
    expect(prisma.releaseAnnouncement.updateMany).toHaveBeenCalledWith({
      where: { id: RELEASE_ID, completedAt: null },
      data: { completedAt: expect.any(Date) },
    });
    expect(addValidatedJobMock).not.toHaveBeenCalled();
    // Nothing was ever delivered — no tally to compute.
    expect(computeCompletionSummaryMock).not.toHaveBeenCalled();
  });

  it('stamps a zero-pending zombie complete and logs the full delivery tally', async () => {
    const prisma = makePrisma({ wedged: [wedgedAnnouncement], totalRows: 5, pendingRows: [] });
    const summary = await sweepIncompleteBroadcasts({
      prisma: prisma as unknown as PrismaClient,
      queue,
    });

    expect(summary.stamped).toEqual(['v-wedged']);
    expect(addValidatedJobMock).not.toHaveBeenCalled();
    // Real deliveries happened before the crash, and this stamp consumes the
    // completion flip — the tally must be computed HERE (the gateway log is
    // the record; no /deliveries report can ever carry it afterwards).
    expect(computeCompletionSummaryMock).toHaveBeenCalledWith(prisma, RELEASE_ID);
  });

  it('skips the tally when a concurrent reporter already won the completion flip', async () => {
    const prisma = makePrisma({ wedged: [wedgedAnnouncement], totalRows: 5, pendingRows: [] });
    prisma.releaseAnnouncement.updateMany.mockResolvedValueOnce({ count: 0 });
    await sweepIncompleteBroadcasts({ prisma: prisma as unknown as PrismaClient, queue });

    // The winner's own path logged/carried the summary — no double record.
    expect(computeCompletionSummaryMock).not.toHaveBeenCalled();
  });

  it('terminalizes no-longer-eligible pending rows and re-enqueues only the still-eligible', async () => {
    const prisma = makePrisma({
      wedged: [wedgedAnnouncement],
      totalRows: 2,
      pendingRows: [
        { id: 'row-a', userId: USER_A, user: { discordId: '111' } },
        { id: 'row-b', userId: USER_B, user: { discordId: '222' } },
      ],
      enabledUserIds: [USER_A],
    });
    prisma.releaseDeliveryLog.updateMany.mockResolvedValueOnce({ count: 1 });
    const summary = await sweepIncompleteBroadcasts({
      prisma: prisma as unknown as PrismaClient,
      queue,
    });

    // Re-eligibility mirrors BOTH enqueue-time gates that can drift after
    // enqueue: the opt-out flag AND the level threshold (a user who raised
    // their level above this minor release must not be re-DMed).
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [USER_A, USER_B] },
        notifyEnabled: true,
        notifyLevel: { in: ['minor', 'patch'] },
      },
      select: { id: true },
    });
    // B no longer qualifies — the row terminalizes, never re-DMs.
    expect(prisma.releaseDeliveryLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['row-b'] }, status: 'pending' },
      data: { status: 'failed_permanent', errorCode: 'opted_out', attemptedAt: expect.any(Date) },
    });
    expect(summary.optedOutTerminalized).toBe(1);
    expect(summary.reEnqueued).toEqual(['v-wedged']);

    expect(addValidatedJobMock).toHaveBeenCalledTimes(1);
    const [, , payload, opts] = addValidatedJobMock.mock.calls[0] as [
      unknown,
      unknown,
      {
        version: string;
        body: string;
        recipients: { deliveryLogId: string; discordUserId: string }[];
      },
      { jobId: string },
    ];
    // The job schema's `version` is the release LABEL, not the numeric
    // schema-version — it must come off the announcement row.
    expect(payload.version).toBe('v-wedged');
    expect(payload.body).toBe('notes');
    expect(payload.recipients).toEqual([
      { deliveryLogId: 'row-a', userId: USER_A, discordUserId: '111' },
    ]);
    // Unique resweep jobIds: the original batch ids may still occupy BullMQ's
    // dedup history, which would silently eat a same-id retry.
    expect(opts.jobId).toMatch(new RegExp(`^release-broadcast:${RELEASE_ID}:resweep:\\d+:0$`));
  });

  it('reports the terminalize UPDATE count, not the candidate count (live-worker race)', async () => {
    const prisma = makePrisma({
      wedged: [wedgedAnnouncement],
      totalRows: 2,
      pendingRows: [
        { id: 'row-a', userId: USER_A, user: { discordId: '111' } },
        { id: 'row-b', userId: USER_B, user: { discordId: '222' } },
      ],
      enabledUserIds: [USER_A],
    });
    // Between the candidate SELECT and the terminalize UPDATE, row-b's send
    // completed (a live worker) — the pending-only guard skips it, and the
    // tally must reflect the delivered truth, not the stale candidate list.
    prisma.releaseDeliveryLog.updateMany.mockResolvedValueOnce({ count: 0 });
    const summary = await sweepIncompleteBroadcasts({
      prisma: prisma as unknown as PrismaClient,
      queue,
    });

    expect(summary.optedOutTerminalized).toBe(0);
  });

  it('attaches previousDm from the shared resolver so retries keep the one-DM invariant', async () => {
    resolvePreviousDmsMock.mockResolvedValue(
      new Map([[USER_A, { deliveryLogId: 'old-row', messageId: 'old-msg' }]])
    );
    const prisma = makePrisma({
      wedged: [wedgedAnnouncement],
      totalRows: 1,
      pendingRows: [{ id: 'row-a', userId: USER_A, user: { discordId: '111' } }],
      enabledUserIds: [USER_A],
    });
    await sweepIncompleteBroadcasts({ prisma: prisma as unknown as PrismaClient, queue });

    const payload = addValidatedJobMock.mock.calls[0][2] as {
      recipients: { previousDm?: { deliveryLogId: string; messageId: string } }[];
    };
    expect(payload.recipients[0].previousDm).toEqual({
      deliveryLogId: 'old-row',
      messageId: 'old-msg',
    });
  });

  it('splits a large pending set into 50-recipient batches', async () => {
    const pendingRows = Array.from({ length: 51 }, (_unused, i) => ({
      id: `row-${i}`,
      userId: `${String(i).padStart(8, '0')}-e89b-42d3-a456-426614174000`,
      user: { discordId: `d${i}` },
    }));
    const prisma = makePrisma({
      wedged: [wedgedAnnouncement],
      totalRows: 51,
      pendingRows,
      enabledUserIds: pendingRows.map(row => row.userId),
    });
    await sweepIncompleteBroadcasts({ prisma: prisma as unknown as PrismaClient, queue });

    expect(addValidatedJobMock).toHaveBeenCalledTimes(2);
  });

  it('caps healing at MAX_RESWEEPS_PER_RUN and reports capped', async () => {
    const wedged = Array.from({ length: MAX_RESWEEPS_PER_RUN + 1 }, (_unused, i) => ({
      id: `${String(i).padStart(8, '0')}-e89b-42d3-a456-426614174000`,
      version: `v-${i}`,
      body: 'notes',
      level: 'major',
    }));
    const prisma = makePrisma({ wedged, totalRows: 0, pendingRows: [] });
    const summary = await sweepIncompleteBroadcasts({
      prisma: prisma as unknown as PrismaClient,
      queue,
    });

    expect(summary.capped).toBe(true);
    expect(summary.stamped).toHaveLength(MAX_RESWEEPS_PER_RUN);
  });
});

describe('createGitHubReleasesFetcher', () => {
  const RELEASES_JSON = [
    {
      id: 5,
      tag_name: 'v3.0.0-beta.165',
      name: 'v3.0.0-beta.165',
      body: '### Bug Fixes\n- y',
      draft: false,
      prerelease: false,
      html_url: 'https://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.165',
      published_at: '2026-07-14T06:00:00Z',
    },
  ];

  function makeFetchImpl(response: { ok: boolean; status?: number; json?: unknown }) {
    return vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? 200,
      json: () => Promise.resolve(response.json),
    }) as unknown as typeof fetch;
  }

  it('sends the GitHub API headers and parses the release list', async () => {
    const fetchImpl = makeFetchImpl({ ok: true, json: RELEASES_JSON });
    const releases = await createGitHubReleasesFetcher({}, fetchImpl)();
    expect(releases).toHaveLength(1);
    expect(releases[0].tag_name).toBe('v3.0.0-beta.165');

    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/repos/lbds137/tzurot/releases');
    expect(init.headers.accept).toBe('application/vnd.github+json');
    expect(init.headers['x-github-api-version']).toBe('2022-11-28');
    expect(init.headers).not.toHaveProperty('authorization');
  });

  it('sends the bearer token only when configured', async () => {
    const fetchImpl = makeFetchImpl({ ok: true, json: RELEASES_JSON });
    await createGitHubReleasesFetcher({ token: 'github_pat_x' }, fetchImpl)();
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.authorization).toBe('Bearer github_pat_x');
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = makeFetchImpl({ ok: false, status: 403 });
    await expect(createGitHubReleasesFetcher({}, fetchImpl)()).rejects.toThrow('HTTP 403');
  });

  it('throws when the payload fails schema validation', async () => {
    const fetchImpl = makeFetchImpl({ ok: true, json: [{ nope: true }] });
    await expect(createGitHubReleasesFetcher({}, fetchImpl)()).rejects.toThrow('schema validation');
  });
});
