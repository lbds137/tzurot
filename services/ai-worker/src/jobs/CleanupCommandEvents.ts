/**
 * Cleanup Command Events
 *
 * Utility function that removes command-invocation telemetry rows older than
 * the retention period. Called by the scheduled-jobs worker daily.
 *
 * command_events records THAT a slash/context-menu command ran (name,
 * outcome, latency, coarse location) — never what was said. Retained 12
 * months per the privacy policy, then swept.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('cleanup-command-events');

/** Default retention period in days (12 months, per the privacy policy). */
const RETENTION_DAYS = 365;

/**
 * Result of cleanup operation
 */
interface CommandEventCleanupResult {
  /** Number of command-event rows deleted */
  deletedCount: number;
  /** Cutoff timestamp used for deletion */
  cutoffDate: Date;
  /** Duration of cleanup in milliseconds */
  durationMs: number;
}

/**
 * Clean up command-event telemetry rows older than the retention period.
 *
 * This function deletes all records from command_events where occurredAt is
 * older than retentionDays (default 365 days / 12 months).
 *
 * @param prisma - Prisma client for database operations
 * @param retentionDays - Optional override for retention period (for testing)
 * @returns Cleanup result with count of deleted records
 */
export async function cleanupCommandEvents(
  prisma: PrismaClient,
  retentionDays: number = RETENTION_DAYS
): Promise<CommandEventCleanupResult> {
  const startTime = Date.now();

  // Calculate cutoff date
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  logger.debug(
    { cutoffDate: cutoffDate.toISOString(), retentionDays },
    'Starting cleanup of old command-event telemetry rows'
  );

  try {
    // Delete all rows older than cutoff
    const result = await prisma.commandEvent.deleteMany({
      where: {
        occurredAt: { lt: cutoffDate },
      },
    });

    const durationMs = Date.now() - startTime;

    if (result.count > 0) {
      logger.info(
        { deletedCount: result.count, durationMs, cutoffDate: cutoffDate.toISOString() },
        'Cleanup completed'
      );
    } else {
      logger.debug({ durationMs }, 'No command events to clean up (all within retention period)');
    }

    return {
      deletedCount: result.count,
      cutoffDate,
      durationMs,
    };
  } catch (error) {
    logger.error({ err: error }, 'Error during cleanup');
    throw error;
  }
}
