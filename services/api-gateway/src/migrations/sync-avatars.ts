/**
 * Avatar Sync: Sync avatars from database to filesystem cache
 *
 * Database is source of truth. On startup, check if versioned avatar files exist
 * on the volume. If they don't exist, decode from DB and write versioned files.
 *
 * Files are stored with timestamps in the filename: {slug}-{timestamp}.png
 * This enables automatic cache invalidation when avatars are updated.
 *
 * This replaces the old migrate-avatars.ts approach which bundled files
 * in the deployment.
 */

import { writeFile, access, readdir, unlink } from 'fs/promises';
import { resolve } from 'path';
import { getPrismaClient, createLogger } from '@tzurot/common-types';
import {
  extractSlugFromFilename,
  extractTimestampFromFilename,
  isValidSlug,
  AVATAR_ROOT,
} from '../utils/avatarPaths.js';

const logger = createLogger('avatar-sync');
const prisma = getPrismaClient();

/**
 * Attempts to delete a single avatar file, returning true on success
 * Silently ignores ENOENT (file already deleted)
 */
async function tryDeleteFile(filePath: string, file: string): Promise<boolean> {
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    const errCode = (error as NodeJS.ErrnoException).code;
    if (errCode !== 'ENOENT') {
      logger.warn({ err: error, file }, '[Avatar Sync] Failed to delete old version');
    }
    return false;
  }
}

/**
 * Cleanup old avatar versions for a slug during sync
 * Synchronous cleanup during startup for deterministic behavior
 */
async function cleanupOldVersionsSync(slug: string, currentTimestamp: number): Promise<number> {
  try {
    const files = await readdir(AVATAR_ROOT);
    let deletedCount = 0;

    for (const file of files) {
      const fileSlug = extractSlugFromFilename(file);
      if (fileSlug !== slug) {
        continue;
      }

      const fileTimestamp = extractTimestampFromFilename(file);
      // Skip the current version
      if (fileTimestamp === currentTimestamp) {
        continue;
      }

      // Delete legacy files (no timestamp) and old versions
      const filePath = resolve(AVATAR_ROOT, file);
      if (await tryDeleteFile(filePath, file)) {
        deletedCount++;
        logger.debug({ slug, file }, '[Avatar Sync] Deleted old version');
      }
    }

    return deletedCount;
  } catch (error) {
    const errCode = (error as NodeJS.ErrnoException).code;
    if (errCode === 'ENOENT') {
      return 0; // Directory doesn't exist yet
    }
    throw error;
  }
}

export async function syncAvatars(): Promise<void> {
  logger.info('[Avatar Sync] Starting avatar sync from database...');

  try {
    // Query all personalities with avatar data
    const personalities = await prisma.personality.findMany({
      where: {
        avatarData: { not: null },
      },
      select: {
        slug: true,
        avatarData: true,
        updatedAt: true,
      },
    });

    if (personalities.length === 0) {
      logger.info('[Avatar Sync] No personalities with avatar data found');
      return;
    }

    logger.info(`[Avatar Sync] Found ${personalities.length} personalities with avatars`);

    let syncedCount = 0;
    let skippedCount = 0;
    let cleanedCount = 0;

    for (const personality of personalities) {
      // Validate slug for safety
      if (!isValidSlug(personality.slug)) {
        logger.warn({ slug: personality.slug }, '[Avatar Sync] Skipping invalid slug');
        continue;
      }

      const timestamp = personality.updatedAt.getTime();
      const versionedFilename = `${personality.slug}-${timestamp}.png`;
      const avatarPath = resolve(AVATAR_ROOT, versionedFilename);

      try {
        // Check if exact versioned file already exists
        await access(avatarPath);
        logger.debug(
          { slug: personality.slug, timestamp },
          '[Avatar Sync] Versioned avatar exists'
        );
        skippedCount++;
        continue;
      } catch {
        // File doesn't exist, create it from DB
      }

      // Skip if no avatar data (should not happen due to where clause, but TypeScript doesn't know that)
      if (personality.avatarData === null) {
        continue;
      }

      // avatarData is already raw bytes, just write to file
      const buffer = Buffer.from(personality.avatarData);
      await writeFile(avatarPath, buffer);

      // Cleanup old versions synchronously during startup
      const cleaned = await cleanupOldVersionsSync(personality.slug, timestamp);
      cleanedCount += cleaned;

      const sizeKB = (buffer.length / 1024).toFixed(2);
      logger.info(
        { slug: personality.slug, timestamp, sizeKB, cleanedVersions: cleaned },
        '[Avatar Sync] Synced avatar'
      );
      syncedCount++;
    }

    logger.info(
      { synced: syncedCount, skipped: skippedCount, cleaned: cleanedCount },
      '[Avatar Sync] Complete'
    );
  } catch (error) {
    logger.error({ err: error }, '[Avatar Sync] Failed to sync avatars');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
