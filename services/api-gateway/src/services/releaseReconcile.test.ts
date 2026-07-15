import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Queue } from 'bullmq';

const announceMock = vi.hoisted(() => vi.fn());
vi.mock('./releaseAnnounce.js', async () => {
  const actual =
    await vi.importActual<typeof import('./releaseAnnounce.js')>('./releaseAnnounce.js');
  return { ...actual, announceGitHubRelease: announceMock };
});

import {
  createGitHubReleasesFetcher,
  reconcileReleaseAnnouncements,
  MAX_ANNOUNCEMENTS_PER_RUN,
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
