/**
 * Verification Cleanup Scheduler
 *
 * Runs periodic cleanup of verification messages approaching the 13-day limit.
 * Uses setInterval since bot-client runs as a single instance and this is
 * an idempotent cleanup operation (safe if run multiple times).
 */

import { createLogger } from '@tzurot/common-types';
import { getVerificationCleanupService } from './VerificationCleanupService.js';

const logger = createLogger('verification-cleanup-scheduler');

/** Run cleanup every 6 hours */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the scheduled cleanup
 * Called after Discord client and cleanup service are initialized
 */
export function startVerificationCleanupScheduler(): void {
  if (cleanupInterval !== null) {
    logger.warn({}, '[VerificationCleanupScheduler] Scheduler already running');
    return;
  }

  // Run cleanup every 6 hours
  cleanupInterval = setInterval(() => {
    void runCleanup();
  }, CLEANUP_INTERVAL_MS);

  // Run once immediately on startup (after a short delay to ensure everything is ready)
  setTimeout(() => {
    void runCleanup();
  }, 30000); // 30 second delay

  logger.info(
    { intervalHours: CLEANUP_INTERVAL_MS / (60 * 60 * 1000) },
    '[VerificationCleanupScheduler] Started scheduled cleanup'
  );
}

/**
 * Stop the scheduled cleanup
 * Called during graceful shutdown
 */
export function stopVerificationCleanupScheduler(): void {
  if (cleanupInterval !== null) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info('[VerificationCleanupScheduler] Stopped scheduled cleanup');
  }
}

/**
 * Run the cleanup operation
 */
async function runCleanup(): Promise<void> {
  try {
    const service = getVerificationCleanupService();
    const result = await service.cleanupExpiredMessages();

    if (result.processed > 0) {
      logger.info(
        { processed: result.processed, deleted: result.deleted, failed: result.failed },
        '[VerificationCleanupScheduler] Completed scheduled cleanup'
      );
    } else {
      logger.debug('[VerificationCleanupScheduler] No expired messages to clean up');
    }
  } catch (error) {
    logger.error({ err: error }, '[VerificationCleanupScheduler] Failed to run scheduled cleanup');
  }
}
