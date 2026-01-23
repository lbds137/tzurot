/**
 * Cleanup Diagnostic Logs
 *
 * Utility function that removes LLM diagnostic logs older than the retention period.
 * Called by the scheduled-jobs worker on an hourly basis.
 *
 * Diagnostic logs are ephemeral debug data with 24-hour retention.
 * They capture full LLM request/response data for debugging prompt issues.
 */

import { createLogger, type PrismaClient } from '@tzurot/common-types';

const logger = createLogger('cleanup-diagnostic-logs');

/** Default retention period in hours */
const RETENTION_HOURS = 24;

/**
 * Result of cleanup operation
 */
export interface DiagnosticCleanupResult {
  /** Number of diagnostic logs deleted */
  deletedCount: number;
  /** Cutoff timestamp used for deletion */
  cutoffDate: Date;
  /** Duration of cleanup in milliseconds */
  durationMs: number;
}

/**
 * Clean up diagnostic logs older than the retention period.
 *
 * This function deletes all records from llm_diagnostic_logs where
 * createdAt is older than RETENTION_HOURS (default 24 hours).
 *
 * @param prisma - Prisma client for database operations
 * @param retentionHours - Optional override for retention period (for testing)
 * @returns Cleanup result with count of deleted records
 */
export async function cleanupDiagnosticLogs(
  prisma: PrismaClient,
  retentionHours: number = RETENTION_HOURS
): Promise<DiagnosticCleanupResult> {
  const startTime = Date.now();

  // Calculate cutoff date
  const cutoffDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

  logger.debug(
    { cutoffDate: cutoffDate.toISOString(), retentionHours },
    '[DiagnosticCleanup] Starting cleanup of old diagnostic logs'
  );

  try {
    // Delete all logs older than cutoff
    const result = await prisma.llmDiagnosticLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    const durationMs = Date.now() - startTime;

    if (result.count > 0) {
      logger.info(
        { deletedCount: result.count, durationMs, cutoffDate: cutoffDate.toISOString() },
        '[DiagnosticCleanup] Cleanup completed'
      );
    } else {
      logger.debug(
        { durationMs },
        '[DiagnosticCleanup] No logs to clean up (all within retention period)'
      );
    }

    return {
      deletedCount: result.count,
      cutoffDate,
      durationMs,
    };
  } catch (error) {
    logger.error({ err: error }, '[DiagnosticCleanup] Error during cleanup');
    throw error;
  }
}
