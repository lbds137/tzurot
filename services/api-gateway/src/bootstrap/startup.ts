/**
 * Startup Utilities
 *
 * Initialization and validation functions run during server startup.
 */

import { access, mkdir, readdir } from 'fs/promises';
import { createLogger, getConfig, HealthStatus } from '@tzurot/common-types';

const logger = createLogger('api-gateway');
const envConfig = getConfig();

const AVATAR_STORAGE_PATH = '/data/avatars';

/**
 * Validate BYOK (Bring Your Own Key) encryption configuration
 * Logs clear warning if not configured, throws if key is invalid format
 */
export function validateByokConfiguration(): void {
  const encryptionKey = envConfig.API_KEY_ENCRYPTION_KEY;

  if (encryptionKey === undefined || encryptionKey.length === 0) {
    logger.warn(
      { component: 'BYOK' },
      '[Gateway] API_KEY_ENCRYPTION_KEY not configured - BYOK is DISABLED. ' +
        'Users will NOT be able to store their own API keys. ' +
        'All requests will use system API keys from environment variables. ' +
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

  logger.info('[Gateway] BYOK encryption key validated - user API key storage is ENABLED');
}

/**
 * Ensure a directory exists, creating it if necessary
 */
async function ensureDirectory(path: string, name: string): Promise<void> {
  try {
    await access(path);
    logger.info(`[Gateway] ${name} directory exists`);
  } catch {
    try {
      await mkdir(path, { recursive: true });
      logger.info(`[Gateway] Created ${name} directory at ${path}`);
    } catch (createError) {
      logger.error({ err: createError }, `[Gateway] Failed to create ${name} directory`);
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
 * Ensure temp attachment storage directory exists
 */
export async function ensureTempAttachmentDirectory(): Promise<void> {
  await ensureDirectory('/data/temp-attachments', 'Temp attachment storage');
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
 * Log warning if service auth secret is not configured
 */
export function validateServiceAuthConfig(): void {
  if (
    envConfig.INTERNAL_SERVICE_SECRET === undefined ||
    envConfig.INTERNAL_SERVICE_SECRET.length === 0
  ) {
    logger.warn(
      {},
      '[Gateway] INTERNAL_SERVICE_SECRET is not set - all protected endpoints will reject requests. ' +
        'Set INTERNAL_SERVICE_SECRET as a shared Railway variable to enable service-to-service auth.'
    );
  }
}
