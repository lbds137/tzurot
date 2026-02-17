/**
 * Generic Stuck Job Cleanup
 *
 * Factory for creating cleanup functions that find jobs stuck in 'in_progress'
 * status for over an hour and mark them as failed. Used by both import and
 * export cleanup scheduled jobs.
 */

import { createLogger, type PrismaClient } from '@tzurot/common-types';

/** How long an in_progress job can run before being considered stuck */
const STUCK_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export interface StuckJobCleanupResult {
  cleanedCount: number;
  durationMs: number;
}

interface StuckJob {
  id: string;
  sourceSlug: string;
  startedAt: Date | null;
}

export interface CleanupConfig {
  /** Logger name (e.g., 'cleanup-stuck-imports') */
  loggerName: string;
  /** Log prefix (e.g., '[StuckImportCleanup]') */
  logPrefix: string;
  /** Job ID field name in logs (e.g., 'importJobId') */
  jobIdLogField: string;
  /** User-facing error message */
  errorMessage: string;
  /** Find stuck jobs via Prisma — model-specific query */
  findStuckJobs: (prisma: PrismaClient, cutoff: Date) => Promise<StuckJob[]>;
  /** Mark jobs as failed via Prisma — model-specific update */
  markJobsFailed: (
    prisma: PrismaClient,
    jobIds: string[],
    errorMessage: string
  ) => Promise<{ count: number }>;
}

export function createStuckJobCleanup(config: CleanupConfig) {
  const logger = createLogger(config.loggerName);

  return async function cleanupStuckJobs(
    prisma: PrismaClient,
    thresholdMs: number = STUCK_THRESHOLD_MS
  ): Promise<StuckJobCleanupResult> {
    const startTime = Date.now();
    const cutoff = new Date(Date.now() - thresholdMs);

    try {
      const stuckJobs = await config.findStuckJobs(prisma, cutoff);

      if (stuckJobs.length === 0) {
        return { cleanedCount: 0, durationMs: Date.now() - startTime };
      }

      const stuckIds = stuckJobs.map(j => j.id);
      await config.markJobsFailed(prisma, stuckIds, config.errorMessage);

      for (const job of stuckJobs) {
        logger.info(
          { [config.jobIdLogField]: job.id, sourceSlug: job.sourceSlug, startedAt: job.startedAt },
          `${config.logPrefix} Marked stuck job as failed`
        );
      }

      const durationMs = Date.now() - startTime;
      logger.info(
        { cleanedCount: stuckJobs.length, durationMs },
        `${config.logPrefix} Cleanup completed`
      );

      return { cleanedCount: stuckJobs.length, durationMs };
    } catch (error) {
      logger.error({ err: error }, `${config.logPrefix} Error during cleanup`);
      throw error;
    }
  };
}
