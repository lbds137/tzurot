/**
 * Verification Cleanup Scheduler
 *
 * Runs periodic cleanup of verification messages approaching the 13-day limit.
 * Uses setInterval since bot-client runs as a single instance and this is
 * an idempotent cleanup operation (safe if run multiple times).
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { createIntervalScheduler } from '../utils/intervalScheduler.js';
import { getVerificationCleanupService } from './VerificationCleanupService.js';

const logger = createLogger('verification-cleanup-scheduler');

/** Run cleanup every 6 hours */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Delay the startup run until the Discord client is fully ready. */
const STARTUP_DELAY_MS = 30_000;

const scheduler = createIntervalScheduler({
  intervalMs: CLEANUP_INTERVAL_MS,
  startupDelayMs: STARTUP_DELAY_MS,
  logger,
  run: () => runCleanup(),
});

/**
 * Start the scheduled cleanup
 * Called after Discord client and cleanup service are initialized
 */
export function startVerificationCleanupScheduler(): void {
  scheduler.start();
}

/**
 * Stop the scheduled cleanup
 * Called during graceful shutdown
 */
export function stopVerificationCleanupScheduler(): void {
  scheduler.stop();
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
        'Completed scheduled cleanup'
      );
    } else {
      logger.debug('No expired messages to clean up');
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to run scheduled cleanup');
  }
}
