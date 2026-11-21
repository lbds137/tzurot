/**
 * Startup Utilities
 *
 * Initialization and validation functions run during server startup.
 */

import { access, mkdir, readdir } from 'fs/promises';
import { getConfig } from '@tzurot/common-types/config/config';
import { HealthStatus } from '@tzurot/common-types/constants/service';
import { isEncryptionConfigured } from '@tzurot/common-types/utils/encryption';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('api-gateway');
const envConfig = getConfig();

const AVATAR_STORAGE_PATH = envConfig.AVATAR_STORAGE_PATH;

/**
 * Validate BYOK (Bring Your Own Key) encryption configuration
 * Logs clear warning if not configured, throws if key is invalid format
 */
export function validateByokConfiguration(): void {
  const encryptionKey = envConfig.API_KEY_ENCRYPTION_KEY;

  // The env schema already maps '' to undefined and rejects malformed keys, so the
  // empty/length/hex checks below are defence in depth for non-schema callers.
  if (encryptionKey === undefined || encryptionKey.length === 0) {
    // Deployed only: a local run legitimately has no BYOK key (the local .env omits it).
    if (envConfig.RAILWAY_ENVIRONMENT_NAME !== undefined) {
      throw new Error(
        `API_KEY_ENCRYPTION_KEY is not set (RAILWAY_ENVIRONMENT_NAME="${envConfig.RAILWAY_ENVIRONMENT_NAME}"). ` +
          "Without it stored BYOK keys cannot be decrypted, so every BYOK user's requests would fail. " +
          'Set API_KEY_ENCRYPTION_KEY on this Railway service.'
      );
    }
    logger.warn(
      { component: 'BYOK' },
      '[Gateway] API_KEY_ENCRYPTION_KEY not configured - stored BYOK keys cannot be decrypted. ' +
        'Requests from users with a stored key will fail; users without a key use system API keys from environment variables. ' +
        'To enable BYOK, set API_KEY_ENCRYPTION_KEY to a 64-character hex string (32 bytes).'
    );
    return;
  }

  // Validate key format
  if (encryptionKey.length !== 64) {
    throw new Error(
      `Invalid API_KEY_ENCRYPTION_KEY: must be 64 hex characters (32 bytes), got ${encryptionKey.length} characters`
    );
  }

  if (!/^[0-9a-fA-F]+$/.test(encryptionKey)) {
    throw new Error('Invalid API_KEY_ENCRYPTION_KEY: must contain only hexadecimal characters');
  }

  // The primary key is well formed; a rotation-window API_KEY_ENCRYPTION_KEY_PREVIOUS
  // (not in the config schema) can still be malformed, which breaks decryption too.
  if (envConfig.RAILWAY_ENVIRONMENT_NAME !== undefined && !isEncryptionConfigured()) {
    throw new Error(
      'API_KEY_ENCRYPTION_KEY or API_KEY_ENCRYPTION_KEY_PREVIOUS is malformed ' +
        `(RAILWAY_ENVIRONMENT_NAME="${envConfig.RAILWAY_ENVIRONMENT_NAME}"). ` +
        "Stored BYOK keys cannot be decrypted, so every BYOK user's requests would fail. " +
        'Fix the variable on this Railway service.'
    );
  }

  logger.info('BYOK encryption key validated - user API key storage is ENABLED');
}

/**
 * Ensure a directory exists, creating it if necessary
 */
async function ensureDirectory(path: string, name: string): Promise<void> {
  try {
    await access(path);
    logger.info({ name }, 'Directory exists');
  } catch {
    try {
      await mkdir(path, { recursive: true });
      logger.info({ name, path }, 'Created directory');
    } catch (createError) {
      logger.error({ err: createError }, `Failed to create ${name} directory`);
      throw createError;
    }
  }
}

/**
 * Ensure avatar storage directory exists
 */
export async function ensureAvatarDirectory(): Promise<void> {
  await ensureDirectory(AVATAR_STORAGE_PATH, 'Avatar storage');
}

/**
 * Check avatar storage health
 */
export async function checkAvatarStorage(): Promise<{
  status: HealthStatus;
  count?: number;
  error?: string;
}> {
  try {
    await access(AVATAR_STORAGE_PATH);
    const files = await readdir(AVATAR_STORAGE_PATH);
    return { status: HealthStatus.Ok, count: files.length };
  } catch (error) {
    return {
      status: HealthStatus.Error,
      error: error instanceof Error ? error.message : 'Avatar storage not accessible',
    };
  }
}

/**
 * Validate required environment variables
 */
export function validateRequiredEnvVars(): void {
  if (envConfig.REDIS_URL === undefined || envConfig.REDIS_URL.length === 0) {
    throw new Error('REDIS_URL environment variable is required');
  }

  if (envConfig.DATABASE_URL === undefined || envConfig.DATABASE_URL.length === 0) {
    throw new Error('DATABASE_URL environment variable is required');
  }
}

/**
 * Validate service auth secret is configured. Throws at startup so a
 * misconfigured deploy fails to boot rather than silently 403-ing every
 * protected-route request. Symmetric with ai-worker and bot-client startup checks.
 */
export function validateServiceAuthConfig(): void {
  if (
    envConfig.INTERNAL_SERVICE_SECRET === undefined ||
    envConfig.INTERNAL_SERVICE_SECRET.length === 0
  ) {
    throw new Error(
      'INTERNAL_SERVICE_SECRET environment variable is required (service-to-service auth for protected gateway routes)'
    );
  }
}
