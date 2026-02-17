/**
 * Cleanup Stuck Import Jobs
 *
 * Finds import jobs stuck in 'in_progress' status for over an hour
 * (e.g., due to worker crash mid-import) and marks them as failed
 * so users can retry.
 *
 * Called by the scheduled-jobs worker every 15 minutes.
 */

import { createLogger, type PrismaClient } from '@tzurot/common-types';

const logger = createLogger('cleanup-stuck-imports');

/** How long an in_progress job can run before being considered stuck */
const STUCK_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Result of stuck import job cleanup
 */
export interface StuckImportCleanupResult {
  /** Number of stuck jobs cleaned up */
  cleanedCount: number;
  /** Duration of cleanup in milliseconds */
  durationMs: number;
}

/**
 * Find and fail import jobs that have been in_progress for too long.
 *
 * When a worker dies mid-import, the ImportJob stays in_progress forever.
 * The import route blocks retries for pending and in_progress jobs,
 * so users get stuck. This function marks those jobs as failed with
 * a descriptive error message so users can retry.
 *
 * @param prisma - Prisma client for database operations
 * @param thresholdMs - Optional override for stuck threshold (for testing)
 */
export async function cleanupStuckImportJobs(
  prisma: PrismaClient,
  thresholdMs: number = STUCK_THRESHOLD_MS
): Promise<StuckImportCleanupResult> {
  const startTime = Date.now();
  const cutoff = new Date(Date.now() - thresholdMs);

  try {
    const stuckJobs = await prisma.importJob.findMany({
      where: {
        status: 'in_progress',
        startedAt: { lt: cutoff },
      },
      select: { id: true, sourceSlug: true, startedAt: true },
      take: 500,
    });

    if (stuckJobs.length === 0) {
      return { cleanedCount: 0, durationMs: Date.now() - startTime };
    }

    const stuckIds = stuckJobs.map(j => j.id);

    await prisma.importJob.updateMany({
      where: { id: { in: stuckIds } },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: 'Job timed out — worker may have restarted. You can retry the import.',
      },
    });

    for (const job of stuckJobs) {
      logger.info(
        { importJobId: job.id, sourceSlug: job.sourceSlug, startedAt: job.startedAt },
        '[StuckImportCleanup] Marked stuck import job as failed'
      );
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      { cleanedCount: stuckJobs.length, durationMs },
      '[StuckImportCleanup] Cleanup completed'
    );

    return { cleanedCount: stuckJobs.length, durationMs };
  } catch (error) {
    logger.error({ err: error }, '[StuckImportCleanup] Error during cleanup');
    throw error;
  }
}
