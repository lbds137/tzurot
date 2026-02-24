/**
 * Verification Cleanup Service Singleton
 *
 * Manages the lifecycle of the VerificationMessageCleanup service.
 * Initialized after Discord client is ready.
 */

import type { Client } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { redis } from '../redis.js';
import { VerificationMessageCleanup } from './VerificationMessageCleanup.js';

const logger = createLogger('verification-cleanup-service');

let cleanupService: VerificationMessageCleanup | null = null;

/**
 * Initialize the verification message cleanup service
 * Called after Discord client is ready
 */
export function initVerificationCleanupService(client: Client): void {
  if (cleanupService !== null) {
    logger.warn({}, '[VerificationCleanup] Service already initialized');
    return;
  }

  cleanupService = new VerificationMessageCleanup(client, redis);
  logger.info('[VerificationCleanup] Service initialized');
}

/**
 * Get the verification cleanup service instance
 * Throws if not initialized
 */
export function getVerificationCleanupService(): VerificationMessageCleanup {
  if (cleanupService === null) {
    throw new Error('VerificationMessageCleanup service not initialized');
  }
  return cleanupService;
}

/**
 * Clean up verification messages for a user
 * Safe to call - logs warning if service not initialized
 */
export async function cleanupVerificationMessagesForUser(userId: string): Promise<void> {
  if (cleanupService === null) {
    logger.warn({ userId }, '[VerificationCleanup] Cannot cleanup - service not initialized');
    return;
  }

  await cleanupService.cleanupForUser(userId);
}

/**
 * Reset singleton state for testing
 * Matches the serviceRegistry.resetServices() pattern
 */
export function resetForTesting(): void {
  cleanupService = null;
}
