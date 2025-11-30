/**
 * Startup Utilities
 *
 * Initialization and validation functions run during bot-client startup.
 */

import { createLogger, getConfig } from '@tzurot/common-types';

const logger = createLogger('bot-client');

/**
 * Validate Discord token is configured
 * @throws Error if DISCORD_TOKEN is missing
 */
export function validateDiscordToken(config = getConfig()): void {
  if (config.DISCORD_TOKEN === undefined || config.DISCORD_TOKEN.length === 0) {
    logger.error({}, 'DISCORD_TOKEN is required for bot-client');
    throw new Error('DISCORD_TOKEN environment variable is required');
  }
}

/**
 * Validate Redis URL is configured
 * @throws Error if REDIS_URL is missing
 */
export function validateRedisUrl(config = getConfig()): void {
  if (config.REDIS_URL === undefined || config.REDIS_URL.length === 0) {
    throw new Error('REDIS_URL environment variable is required');
  }
}

/**
 * Log gateway health check result
 * @param isHealthy Whether the gateway health check passed
 */
export function logGatewayHealthStatus(isHealthy: boolean): void {
  if (!isHealthy) {
    logger.warn({}, '[Bot] Gateway health check failed, but continuing...');
  } else {
    logger.info('[Bot] Gateway is healthy');
  }
}
