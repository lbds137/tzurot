import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Queue } from 'bullmq';

const enqueueBroadcastMock = vi.hoisted(() => vi.fn());
vi.mock('./releaseBroadcast.js', () => ({
  enqueueBroadcast: enqueueBroadcastMock,
}));

import { announceGitHubRelease } from './releaseAnnounce.js';
import type { GitHubRelease } from '@tzurot/common-types/schemas/github/release';

const deps = {
  prisma: {} as PrismaClient,
  queue: {} as Queue,
};

function makeRelease(overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    id: 987654321,
    tag_name: 'v3.0.0-beta.166',
    name: 'v3.0.0-beta.166',
    body: '### Features\n- **bot-client:** announcement DMs (#1651)',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.166',
    published_at: '2026-07-15T04:00:00Z',
    ...overrides,
  };
}

describe('announceGitHubRelease', () => {
  beforeEach(() => {
    enqueueBroadcastMock.mockReset();
  });

  it('skips drafts and prereleases without touching the pipeline', async () => {
    const draft = await announceGitHubRelease(deps, makeRelease({ draft: true }));
    expect(draft).toEqual({ status: 'skipped', version: 'v3.0.0-beta.166', reason: 'draft' });

    const pre = await announceGitHubRelease(deps, makeRelease({ prerelease: true }));
    expect(pre).toEqual({ status: 'skipped', version: 'v3.0.0-beta.166', reason: 'prerelease' });

    expect(enqueueBroadcastMock).not.toHaveBeenCalled();
  });

  it('passes tag_name verbatim, the derived level, and the stringified id across the seam', async () => {
    enqueueBroadcastMock.mockResolvedValue({
      ok: true,
      releaseId: 'uuid',
      recipients: 12,
      batches: 1,
    });

    const outcome = await announceGitHubRelease(deps, makeRelease());

    expect(enqueueBroadcastMock).toHaveBeenCalledWith(deps.prisma, deps.queue, {
      version: 'v3.0.0-beta.166',
      level: 'minor',
      body: expect.stringContaining('**v3.0.0-beta.166**'),
      githubReleaseId: '987654321',
    });
    expect(outcome).toEqual({
      status: 'announced',
      version: 'v3.0.0-beta.166',
      level: 'minor',
      recipients: 12,
      batches: 1,
    });
  });

  it('derives major from a Breaking Changes section', async () => {
    enqueueBroadcastMock.mockResolvedValue({
      ok: true,
      releaseId: 'uuid',
      recipients: 1,
      batches: 1,
    });
    await announceGitHubRelease(
      deps,
      makeRelease({ body: '### Breaking Changes\n- everything is different now' })
    );
    expect(enqueueBroadcastMock.mock.calls[0][2].level).toBe('major');
  });

  it('classifies a null body as patch and still announces title + link', async () => {
    enqueueBroadcastMock.mockResolvedValue({
      ok: true,
      releaseId: 'uuid',
      recipients: 1,
      batches: 1,
    });
    await announceGitHubRelease(deps, makeRelease({ body: null }));
    const options = enqueueBroadcastMock.mock.calls[0][2];
    expect(options.level).toBe('patch');
    expect(options.body).toBe(
      '**v3.0.0-beta.166**\n\nhttps://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.166'
    );
  });

  it('maps the already-announced pipeline outcome through', async () => {
    enqueueBroadcastMock.mockResolvedValue({ ok: false, reason: 'already-announced' });
    const outcome = await announceGitHubRelease(deps, makeRelease());
    expect(outcome).toEqual({ status: 'already-announced', version: 'v3.0.0-beta.166' });
  });
});
