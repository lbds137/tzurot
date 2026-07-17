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
 * Two sweeps live here, both invoked by the same hourly run:
 * - reconcileReleaseAnnouncements — the missing-announcement case (a
 *   GitHub release with no announcement row).
 * - sweepIncompleteBroadcasts — the announced-but-incomplete case (a crash
 *   mid-blast left an announcement whose pending ledger rows have no live
 *   job; the unique-version pre-check blocks re-announcing, so without this
 *   sweep the wedge is permanent).
 */

import { z } from 'zod';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { NotifyLevelValue } from '@tzurot/common-types/schemas/api/notifications';
import type { Queue } from 'bullmq';
import { JobType } from '@tzurot/common-types/constants/queue';
import { VALIDATION_TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { addValidatedJob } from '../utils/validatedQueue.js';
import {
  announceGitHubRelease,
  GitHubReleaseSchema,
  type GitHubRelease,
} from './releaseAnnounce.js';
import {
  BROADCAST_BATCH_SIZE,
  computeCompletionSummary,
  eligibleThresholds,
  resolvePreviousDms,
} from './releaseBroadcast.js';

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

// ============================================================================
// Announced-but-incomplete sweep
// ============================================================================

/**
 * An announcement still incomplete this long after creation is wedged, not
 * live: a full blast at ~1 DM/sec finishes in minutes.
 */
export const INCOMPLETE_WEDGE_THRESHOLD_MS = 30 * 60 * 1000;

/** Mirror of the missing-announcement sweep's per-run blast-radius cap. */
export const MAX_RESWEEPS_PER_RUN = 3;

export interface ResweepSummary {
  scanned: number;
  stamped: string[];
  reEnqueued: string[];
  optedOutTerminalized: number;
  capped: boolean;
}

interface PendingRecipientRow {
  id: string;
  userId: string;
  user: { discordId: string };
}

/**
 * Heal announcements a crash left incomplete. Three branches per wedge:
 * zero ledger rows → stamp complete + error-log (never auto-re-blast; the
 * manual path is /admin broadcast); zero pending rows → stamp complete (the
 * transition loop and the completion stamp are separate writes, so a crash
 * between them orphans the release); pending rows → terminalize rows whose user is
 * no longer eligible (opted out or raised their level), then re-enqueue
 * the rest as fresh batches.
 *
 * Delivery semantics: this converts "report permanently lost → row silently
 * under-delivered forever" into at-least-once — a rare duplicate DM is the
 * accepted cost. Double-DM safety is the worker's /pending pre-filter plus
 * bot-client's single-replica / concurrency-1 topology; the pre-filter is a
 * SELECT, not an atomic claim, so if bot-client ever grows replicas the
 * upgrade path is an atomic pending→claimed transition with claim expiry.
 */
export async function sweepIncompleteBroadcasts(
  deps: Pick<ReconcileDeps, 'prisma' | 'queue'>
): Promise<ResweepSummary> {
  const { prisma, queue } = deps;
  const threshold = new Date(Date.now() - INCOMPLETE_WEDGE_THRESHOLD_MS);

  const wedged = await prisma.releaseAnnouncement.findMany({
    where: { completedAt: null, createdAt: { lt: threshold } },
    select: { id: true, version: true, body: true, level: true },
    orderBy: { createdAt: 'asc' },
    take: MAX_RESWEEPS_PER_RUN + 1,
  });

  const summary: ResweepSummary = {
    scanned: wedged.length,
    stamped: [],
    reEnqueued: [],
    optedOutTerminalized: 0,
    capped: wedged.length > MAX_RESWEEPS_PER_RUN,
  };
  if (summary.capped) {
    logger.error(
      { scanned: wedged.length },
      'Incomplete-broadcast sweep hit the per-run cap — investigate the wedge pileup'
    );
  }

  for (const announcement of wedged.slice(0, MAX_RESWEEPS_PER_RUN)) {
    const outcome = await healAnnouncement(prisma, queue, announcement);
    if (outcome.kind === 'stamped') {
      summary.stamped.push(announcement.version);
    } else {
      summary.reEnqueued.push(announcement.version);
    }
    summary.optedOutTerminalized += outcome.optedOut;
  }

  if (summary.scanned > 0) {
    logger.info({ ...summary }, 'Incomplete-broadcast sweep completed');
  }
  return summary;
}

/**
 * Partition a wedged announcement's pending rows into still-eligible
 * recipients and rows to terminalize. Rows whose user is no longer eligible
 * must never be re-DMed — and must be terminalized rather than skipped, or
 * the announcement can never complete. "No longer eligible" mirrors BOTH
 * enqueue-time gates that can drift after enqueue: notifyEnabled (a
 * /notifications disable or an auto-disable) and notifyLevel (the user
 * raised their threshold above this release's level). errorCode 'opted_out'
 * covers both — the user opted out of receiving this release, one way or
 * the other.
 */
async function terminalizeIneligibleRows(
  prisma: PrismaClient,
  level: NotifyLevelValue,
  pendingRows: PendingRecipientRow[]
): Promise<{ stillEligible: PendingRecipientRow[]; terminalizedCount: number }> {
  if (pendingRows.length === 0) {
    return { stillEligible: [], terminalizedCount: 0 };
  }
  const enabledUsers = await prisma.user.findMany({
    where: {
      id: { in: pendingRows.map(row => row.userId) },
      notifyEnabled: true,
      notifyLevel: { in: eligibleThresholds(level) },
    },
    select: { id: true },
  });
  const enabledSet = new Set(enabledUsers.map(user => user.id));
  const stillEligible = pendingRows.filter(row => enabledSet.has(row.userId));
  const optedOutIds = pendingRows.filter(row => !enabledSet.has(row.userId)).map(row => row.id);
  if (optedOutIds.length === 0) {
    return { stillEligible, terminalizedCount: 0 };
  }
  // The reported tally uses the update's REAL count: a candidate row can
  // transition to sent (a live worker) between the SELECT above and this
  // UPDATE — the pending-only guard skips it, and it was delivered, so it
  // must not count as terminalized.
  const terminalized = await prisma.releaseDeliveryLog.updateMany({
    where: { id: { in: optedOutIds }, status: 'pending' },
    data: { status: 'failed_permanent', errorCode: 'opted_out', attemptedAt: new Date() },
  });
  return { stillEligible, terminalizedCount: terminalized.count };
}

async function healAnnouncement(
  prisma: PrismaClient,
  queue: Queue,
  announcement: { id: string; version: string; body: string; level: NotifyLevelValue }
): Promise<{ kind: 'stamped' | 're-enqueued'; optedOut: number }> {
  const releaseId = announcement.id;

  const [totalRows, pendingRows] = await Promise.all([
    prisma.releaseDeliveryLog.count({ where: { releaseId } }),
    prisma.releaseDeliveryLog.findMany({
      where: { releaseId, status: 'pending' },
      select: { id: true, userId: true, user: { select: { discordId: true } } },
    }),
  ]);

  const { stillEligible, terminalizedCount } = await terminalizeIneligibleRows(
    prisma,
    announcement.level,
    pendingRows
  );

  if (stillEligible.length === 0) {
    // Either a zombie (crash between the last transition and the completion
    // stamp), a zero-row orphan (crash before the ledger createMany), or
    // every remaining row just terminalized as opted-out. Flip-guarded like
    // stampCompletionIfFinal: a concurrent /deliveries report may have won —
    // the loser logs nothing (the winner's path carries the record).
    const flip = await prisma.releaseAnnouncement.updateMany({
      where: { id: releaseId, completedAt: null },
      data: { completedAt: new Date() },
    });
    if (totalRows === 0 && flip.count === 1) {
      logger.error(
        { releaseId, version: announcement.version },
        'Announcement had NO ledger rows — stamped complete without delivering; re-announce manually via /admin broadcast if it should have gone out'
      );
    } else if (flip.count === 1) {
      // Real deliveries happened before the crash — this stamp CONSUMES the
      // completion flip, so no /deliveries report will ever carry the tally
      // to the Discord ops embed. Log the full summary here instead: the
      // gateway log is the durable record for resweep-healed completions.
      const summary = await computeCompletionSummary(prisma, releaseId);
      logger.warn(
        { releaseId, ...summary },
        'Resweep stamped completion on a wedged announcement — full tally (no ops embed for resweep-healed blasts; the log is the record)'
      );
    }
    return { kind: 'stamped', optedOut: terminalizedCount };
  }

  const previousDms = await resolvePreviousDms(
    prisma,
    releaseId,
    stillEligible.map(row => row.userId)
  );

  // Unique jobIds: the original batch ids may still sit in BullMQ's history
  // and jobId dedup would silently eat the retry. Double-DM safety comes from
  // the worker's /pending pre-filter, not from id dedup.
  const epochMinute = Math.floor(Date.now() / 60_000);
  let batches = 0;
  for (let start = 0; start < stillEligible.length; start += BROADCAST_BATCH_SIZE) {
    const slice = stillEligible.slice(start, start + BROADCAST_BATCH_SIZE);
    await addValidatedJob(
      queue,
      JobType.ReleaseBroadcastDm,
      {
        requestId: `${releaseId}:resweep:${epochMinute}:${batches}`,
        jobType: JobType.ReleaseBroadcastDm,
        responseDestination: { type: 'api' },
        releaseId,
        // The job schema's `version` is the release's LABEL (it shadows the
        // base schema's numeric schema-version field) — omitting it fails
        // payload validation.
        version: announcement.version,
        body: announcement.body,
        recipients: slice.map(row => ({
          deliveryLogId: row.id,
          userId: row.userId,
          discordUserId: row.user.discordId,
          ...(previousDms.has(row.userId) ? { previousDm: previousDms.get(row.userId) } : {}),
        })),
      },
      { jobId: `release-broadcast:${releaseId}:resweep:${epochMinute}:${batches}` }
    );
    batches += 1;
  }

  logger.info(
    {
      releaseId,
      version: announcement.version,
      reEnqueued: stillEligible.length,
      batches,
      optedOut: terminalizedCount,
    },
    'Re-enqueued pending deliveries for a wedged announcement'
  );
  return { kind: 're-enqueued', optedOut: terminalizedCount };
}
