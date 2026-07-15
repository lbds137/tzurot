/**
 * Release reconcile sweep — the webhook's safety net.
 *
 * GitHub does not retry failed webhook deliveries, and Railway redeploys
 * this service at release-merge BEFORE `release:publish` creates the GitHub
 * release — so a missed `release:published` event needs a puller. The
 * hourly sweep (ai-worker scheduled job → internal route → here) compares
 * the GitHub releases API against release_announcements and announces
 * anything missing, bounded by a lookback window.
 *
 * The window is deliberately short (24h): the previous release is demoted
 * to prerelease only when the NEXT one publishes, so on the feature's first
 * deploy a wide window would announce the stale prior release. After the
 * first cycle, already-announced rows make any window safe; hourly cadence
 * makes 24h operationally plenty. Releases that stay unannounced longer
 * than the window remain silent by design — the internal route accepts a
 * larger lookbackHours (≤168) for deliberate manual catch-up.
 *
 * This sweep owns only the missing-announcement case. The complementary
 * announced-but-incomplete case (a crash mid-enqueue leaves an announcement
 * whose pending ledger rows have no live job) is a planned separate sweep
 * that belongs beside this function, not inside it.
 */

import { z } from 'zod';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Queue } from 'bullmq';
import { VALIDATION_TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  announceGitHubRelease,
  GitHubReleaseSchema,
  type GitHubRelease,
} from './releaseAnnounce.js';

const logger = createLogger('ReleaseReconcile');

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/lbds137/tzurot/releases?per_page=30';

export const DEFAULT_LOOKBACK_HOURS = 24;

/**
 * Hard ceiling on announcements per sweep run. Normal operation announces
 * at most one release per cycle — hitting this cap means a clock or filter
 * bug was about to blast history, so it stops loudly instead.
 */
export const MAX_ANNOUNCEMENTS_PER_RUN = 3;

export type FetchGitHubReleases = () => Promise<GitHubRelease[]>;

/**
 * One-page newest-first fetch: 30 releases always covers any allowed
 * lookback window at this repo's release cadence. Token optional —
 * unauthenticated works, but Railway's shared egress IPs make the
 * per-IP anonymous rate limit unreliable.
 */
export function createGitHubReleasesFetcher(
  options: { token?: string },
  fetchImpl: typeof fetch = fetch
): FetchGitHubReleases {
  return async () => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      VALIDATION_TIMEOUTS.EXTERNAL_GITHUB_API_CALL
    );
    try {
      const response = await fetchImpl(GITHUB_RELEASES_URL, {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'tzurot-api-gateway',
          ...(options.token !== undefined ? { authorization: `Bearer ${options.token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`GitHub releases fetch failed: HTTP ${response.status}`);
      }
      const payload: unknown = await response.json();
      const parsed = z.array(GitHubReleaseSchema).safeParse(payload);
      if (!parsed.success) {
        throw new Error('GitHub releases payload failed schema validation');
      }
      return parsed.data;
    } finally {
      clearTimeout(timer);
    }
  };
}

export interface ReconcileSummary {
  checked: number;
  announced: string[];
  alreadyAnnounced: number;
  skipped: number;
  capped: boolean;
}

export interface ReconcileDeps {
  prisma: PrismaClient;
  queue: Queue;
  fetchReleases: FetchGitHubReleases;
}

export async function reconcileReleaseAnnouncements(
  deps: ReconcileDeps,
  options: { lookbackHours?: number } = {}
): Promise<ReconcileSummary> {
  const lookbackHours = options.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;

  const releases = await deps.fetchReleases();
  const inWindow = releases
    // Drafts carry a null published_at; everything else timestamps.
    .filter(release => {
      if (release.published_at === null || release.published_at === undefined) {
        return false;
      }
      return new Date(release.published_at).getTime() >= cutoff;
    })
    // Oldest first so a multi-release catch-up announces in publish order.
    .sort(
      (a, b) => new Date(a.published_at ?? 0).getTime() - new Date(b.published_at ?? 0).getTime()
    );

  const summary: ReconcileSummary = {
    checked: inWindow.length,
    announced: [],
    alreadyAnnounced: 0,
    skipped: 0,
    capped: false,
  };

  for (const release of inWindow) {
    if (summary.announced.length >= MAX_ANNOUNCEMENTS_PER_RUN) {
      summary.capped = true;
      logger.error(
        { announced: summary.announced, remaining: summary.checked - summary.announced.length },
        'Reconcile hit the per-run announcement cap — investigate before letting more blasts out'
      );
      break;
    }
    const outcome = await announceGitHubRelease(
      { prisma: deps.prisma, queue: deps.queue },
      release
    );
    if (outcome.status === 'announced') {
      summary.announced.push(outcome.version);
    } else if (outcome.status === 'already-announced') {
      summary.alreadyAnnounced += 1;
    } else {
      summary.skipped += 1;
    }
  }

  logger.info({ lookbackHours, ...summary }, 'Release reconcile sweep completed');
  return summary;
}
