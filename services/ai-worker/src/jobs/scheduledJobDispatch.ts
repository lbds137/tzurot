/**
 * Scheduled-job dispatch table for ai-worker's scheduled BullMQ worker.
 *
 * Every name in the `SCHEDULED_JOBS` registry MUST have a handler here — the
 * `Record<ScheduledJobName, ScheduledJobHandler>` return type makes a missing
 * key a compile error, and `scheduledJobDispatch.test.ts` pins the invariant
 * at runtime (registry-vs-handler-keys parity, plus a per-name wiring test).
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ConversationRetentionService } from '@tzurot/conversation-history';
import { cleanupDiagnosticLogs } from './CleanupDiagnosticLogs.js';
import { cleanupCommandEvents } from './CleanupCommandEvents.js';
import { cleanupStuckImportJobs } from './cleanupStuckImportJobs.js';
import { cleanupStuckExportJobs } from './cleanupStuckExportJobs.js';
import { cleanupExpiredExports } from './cleanupExpiredExports.js';
import { cleanupNotificationsRetention } from './cleanupNotificationsRetention.js';
import { triggerReleaseReconcile } from './releaseReconcile.js';
import { sweepRosterBlurbs } from './rosterBlurbSweep.js';
import { sweepRecentDaysDigests } from '../services/recentDaysDigest/recentDaysDigestSweep.js';
import { sweepStaleRecentDaysDigests } from '../services/recentDaysDigest/recentDaysDigestRetention.js';
import { SCHEDULED_JOBS } from './scheduledJobSchedule.js';
import type { PendingMemoryProcessor } from './PendingMemoryProcessor.js';
import type { NullVectorReembedder } from './NullVectorReembedder.js';

const logger = createLogger('scheduledJobDispatch');

export type ScheduledJobName = (typeof SCHEDULED_JOBS)[keyof typeof SCHEDULED_JOBS];

export interface ScheduledJobDeps {
  pendingMemoryProcessor: PendingMemoryProcessor;
  prisma: PrismaClient;
  nullVectorReembedder: NullVectorReembedder;
}

export type ScheduledJobHandler = () => Promise<unknown>;

async function runPendingMemories(deps: ScheduledJobDeps): Promise<unknown> {
  logger.debug('Running pending memory processor');
  const stats = await deps.pendingMemoryProcessor.processPendingMemories();
  // Backlog snapshot rides every run's completed log — the dead-letter
  // rows (attempts >= cap / the 999 invalid-metadata sentinel) are
  // otherwise invisible after their single "Gave up" line.
  const backlog = await deps.pendingMemoryProcessor.getStats();
  return { ...stats, backlog };
}

async function runConversationRetention(deps: ScheduledJobDeps): Promise<unknown> {
  // Retention was manual-only (/admin cleanup, run "when I remember") — this
  // makes the 30-day window deterministic. The manual route stays as the
  // on-demand trigger; both paths share ConversationRetentionService.
  logger.info('Running conversation retention cleanup');
  const retention = new ConversationRetentionService(deps.prisma);
  const oldHistory = await retention.cleanupOldHistory();
  const softDeleted = await retention.cleanupSoftDeletedMessages();
  // Returned object lands in the worker's `completed` log line — the
  // per-table counts are what make a daily run verifiable in Railway logs.
  return { oldHistory, softDeleted };
}

/**
 * Build one handler per `SCHEDULED_JOBS` entry, closing over the shared deps.
 */
export function buildScheduledJobHandlers(
  deps: ScheduledJobDeps
): Record<ScheduledJobName, ScheduledJobHandler> {
  return {
    [SCHEDULED_JOBS.PROCESS_PENDING_MEMORIES]: () => runPendingMemories(deps),
    [SCHEDULED_JOBS.REEMBED_NULL_VECTORS]: () => {
      logger.debug('Running NULL-vector re-embed sweep');
      return deps.nullVectorReembedder.sweep();
    },
    [SCHEDULED_JOBS.CLEANUP_DIAGNOSTIC_LOGS]: () => {
      logger.debug('Running diagnostic log cleanup');
      return cleanupDiagnosticLogs(deps.prisma);
    },
    [SCHEDULED_JOBS.CLEANUP_STUCK_IMPORTS]: () => {
      logger.info('Running stuck import job cleanup');
      return cleanupStuckImportJobs(deps.prisma);
    },
    [SCHEDULED_JOBS.CLEANUP_STUCK_EXPORTS]: () => {
      logger.info('Running stuck export job cleanup');
      return cleanupStuckExportJobs(deps.prisma);
    },
    [SCHEDULED_JOBS.CLEANUP_EXPIRED_EXPORTS]: () => {
      logger.info('Running expired export cleanup');
      return cleanupExpiredExports(deps.prisma);
    },
    [SCHEDULED_JOBS.CLEANUP_CONVERSATION_RETENTION]: () => runConversationRetention(deps),
    [SCHEDULED_JOBS.CLEANUP_NOTIFICATIONS_RETENTION]: () => {
      // 90d handled-only purge (feedback read/archived, settled delivery
      // rows); the returned counts are the daily run's verification trail.
      logger.info('Running notifications/feedback retention cleanup');
      return cleanupNotificationsRetention(deps.prisma);
    },
    [SCHEDULED_JOBS.CLEANUP_COMMAND_EVENTS]: () => {
      logger.info('Running command-event telemetry cleanup');
      return cleanupCommandEvents(deps.prisma);
    },
    [SCHEDULED_JOBS.RELEASE_RECONCILE]: () => {
      // Thin authed trigger — the sweep itself runs in api-gateway, where
      // prisma + the broadcast queue live. The summary in the completed
      // log is the hourly run's verification trail.
      logger.debug('Triggering release reconcile sweep');
      return triggerReleaseReconcile();
    },
    [SCHEDULED_JOBS.ROSTER_BLURB_SWEEP]: () => {
      // No-ops unless the rosterBlurbEnabled system setting is on; the
      // returned stats are the tick's verification trail (and its spend).
      logger.debug('Running roster blurb sweep');
      return sweepRosterBlurbs(deps.prisma);
    },
    [SCHEDULED_JOBS.RECENT_DAYS_DIGEST_SWEEP]: () => {
      // No-ops unless the recentDaysDigestEnabled system setting is on;
      // the returned stats are the tick's verification trail (and its spend).
      logger.debug('Running recent-days digest sweep');
      return sweepRecentDaysDigests(deps.prisma);
    },
    [SCHEDULED_JOBS.RECENT_DAYS_DIGEST_RETENTION]: () => {
      // Runs whether or not recentDaysDigestEnabled is on — retention is not
      // gated on generation. The returned count is the daily run's trail.
      logger.debug('Running recent-days digest retention sweep');
      return sweepStaleRecentDaysDigests(deps.prisma);
    },
  };
}

function isScheduledJobName(name: string): name is ScheduledJobName {
  return (Object.values(SCHEDULED_JOBS) as string[]).includes(name);
}

/**
 * Dispatch a scheduled job by name. A name with no handler (registry drift,
 * or a stale job stuck in the queue from a removed job type) resolves `null`
 * rather than throwing, so the scheduled worker doesn't fail the job.
 */
export async function dispatchScheduledJob(
  handlers: Record<ScheduledJobName, ScheduledJobHandler>,
  jobName: string
): Promise<unknown> {
  if (!isScheduledJobName(jobName)) {
    logger.warn({ jobName }, 'Scheduled job has no handler');
    return null;
  }
  return handlers[jobName]();
}
