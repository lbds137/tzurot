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

// Force cleanup when table has too many old results (prevents unbounded growth in low-volume scenarios)
const CLEANUP_THRESHOLD = 10000;

/**
 * Opportunistically clean up old delivered job results
 *
 * Uses probabilistic triggering to avoid running cleanup on every job.
 * Runs approximately 5% of the time when called.
 *
 * Also forces cleanup if too many old results exist (>10k rows) to prevent
 * unbounded growth in low-volume scenarios.
 *
 * @param prisma Prisma client for database access
 * @param force If true, always run cleanup (ignores probability and threshold)
 */
export async function cleanupOldJobResults(
  prisma: PrismaClient,
  force = false
): Promise<void> {
  try {
    const cutoffTime = new Date(Date.now() - RETENTION_PERIOD_MS);

    // Check if cleanup is needed based on probability or threshold
    let shouldCleanup = force || Math.random() <= CLEANUP_PROBABILITY;

    // Force cleanup if too many old results exist (prevents unbounded growth)
    if (!shouldCleanup) {
      const oldResultsCount = await prisma.jobResult.count({
        where: {
          status: 'DELIVERED',
          deliveredAt: {
            lt: cutoffTime,
          },
        },
      });

      if (oldResultsCount > CLEANUP_THRESHOLD) {
        logger.info(
          { oldResultsCount, threshold: CLEANUP_THRESHOLD },
          '[Cleanup] Forcing cleanup due to threshold exceeded'
        );
        shouldCleanup = true;
      }
    }

    // Skip cleanup if not needed
    if (!shouldCleanup) {
      return;
    }

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
