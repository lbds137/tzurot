/**
 * Cleanup Job Results
 *
 * Opportunistic cleanup of old delivered job results from the database.
 * Prevents unbounded growth of the job_results table.
 *
 * Called occasionally when publishing new job results (probabilistic approach).
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('CleanupJobResults');

// Retention period - keep results for 24 hours after delivery
const RETENTION_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

// Cleanup probability - run cleanup ~5% of the time when publishing results
const CLEANUP_PROBABILITY = 0.05;

/**
 * Opportunistically clean up old delivered job results
 *
 * Uses probabilistic triggering to avoid running cleanup on every job.
 * Runs approximately 5% of the time when called.
 *
 * @param prisma Prisma client for database access
 * @param force If true, always run cleanup (ignores probability)
 */
export async function cleanupOldJobResults(
  prisma: PrismaClient,
  force = false
): Promise<void> {
  // Probabilistic cleanup - only run ~5% of the time (unless forced)
  if (!force && Math.random() > CLEANUP_PROBABILITY) {
    return;
  }

  try {
    const cutoffTime = new Date(Date.now() - RETENTION_PERIOD_MS);

    const result = await prisma.jobResult.deleteMany({
      where: {
        status: 'DELIVERED',
        deliveredAt: {
          lt: cutoffTime,
        },
      },
    });

    if (result.count > 0) {
      logger.info(
        { deletedCount: result.count, cutoffTime },
        `[Cleanup] Removed ${result.count} old job results delivered before ${cutoffTime.toISOString()}`
      );
    } else {
      logger.debug({ cutoffTime }, '[Cleanup] No old job results to clean up');
    }
  } catch (error) {
    logger.error({ err: error }, '[Cleanup] Failed to clean up old job results');
    // Don't throw - this is best-effort cleanup
  }
}
