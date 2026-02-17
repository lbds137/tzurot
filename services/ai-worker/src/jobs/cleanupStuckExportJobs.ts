/**
 * Cleanup Stuck Export Jobs
 *
 * Finds export jobs stuck in 'in_progress' status for over an hour
 * (e.g., due to worker crash mid-export) and marks them as failed
 * so users can retry.
 *
 * Called by the scheduled-jobs worker every 15 minutes.
 */

import { createLogger, type PrismaClient } from '@tzurot/common-types';

const logger = createLogger('cleanup-stuck-exports');

/** How long an in_progress job can run before being considered stuck */
const STUCK_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Result of stuck export job cleanup
 */
export interface StuckExportCleanupResult {
  /** Number of stuck jobs cleaned up */
  cleanedCount: number;
  /** Duration of cleanup in milliseconds */
  durationMs: number;
}

/**
 * Find and fail export jobs that have been in_progress for too long.
 *
 * When a worker dies mid-export, the ExportJob stays in_progress forever.
 * The export route blocks retries for pending and in_progress jobs,
 * so users get stuck. This function marks those jobs as failed with
 * a descriptive error message so users can retry.
 *
 * @param prisma - Prisma client for database operations
 * @param thresholdMs - Optional override for stuck threshold (for testing)
 */
export async function cleanupStuckExportJobs(
  prisma: PrismaClient,
  thresholdMs: number = STUCK_THRESHOLD_MS
): Promise<StuckExportCleanupResult> {
  const startTime = Date.now();
  const cutoff = new Date(Date.now() - thresholdMs);

  try {
    const stuckJobs = await prisma.exportJob.findMany({
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

    await prisma.exportJob.updateMany({
      where: { id: { in: stuckIds } },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: 'Job timed out — worker may have restarted. You can retry the export.',
      },
    });

    for (const job of stuckJobs) {
      logger.info(
        { exportJobId: job.id, sourceSlug: job.sourceSlug, startedAt: job.startedAt },
        '[StuckExportCleanup] Marked stuck export job as failed'
      );
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      { cleanedCount: stuckJobs.length, durationMs },
      '[StuckExportCleanup] Cleanup completed'
    );

    return { cleanedCount: stuckJobs.length, durationMs };
  } catch (error) {
    logger.error({ err: error }, '[StuckExportCleanup] Error during cleanup');
    throw error;
  }
}
