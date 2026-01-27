/**
 * Avatar Sync: Sync avatars from database to filesystem cache
 *
 * Database is source of truth. On startup, check if versioned avatar files exist
 * on the volume. If they don't exist, decode from DB and write versioned files.
 *
 * Directory Structure:
 * /data/avatars/{first-char}/{slug}-{timestamp}.png
 *
 * Examples:
 * - /data/avatars/c/cold-1705827727111.png
 * - /data/avatars/m/my-personality-1705827727111.png
 *
 * The two-level structure reduces files per directory for better performance
 * when the number of personalities grows large (100+).
 *
 * This replaces the old migrate-avatars.ts approach which bundled files
 * in the deployment.
 */

import { writeFile, access, unlink, glob } from 'fs/promises';
import { basename } from 'path';
import { getPrismaClient, createLogger } from '@tzurot/common-types';
import {
  extractSlugFromFilename,
  extractTimestampFromFilename,
  isValidSlug,
  getSafeAvatarPath,
  getAvatarSubdir,
  ensureAvatarDir,
  AVATAR_ROOT,
} from '../utils/avatarPaths.js';

const logger = createLogger('avatar-sync');
const prisma = getPrismaClient();

/**
 * Attempts to delete a single avatar file, returning true on success
 * Silently ignores ENOENT (file already deleted)
 */
async function tryDeleteFile(filePath: string, filename: string): Promise<boolean> {
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    const errCode = (error as NodeJS.ErrnoException).code;
    if (errCode !== 'ENOENT') {
      logger.warn({ err: error, filename }, '[Avatar Sync] Failed to delete old version');
    }
    return false;
  }
}

/**
 * Collects files matching a glob pattern into an array
 */
async function globToArray(pattern: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of glob(pattern)) {
    files.push(file);
  }
  return files;
}

/**
 * Cleanup old avatar versions for a slug during sync
 * Synchronous cleanup during startup for deterministic behavior
 * Uses glob to efficiently find files in the slug's subdirectory
 */
async function cleanupOldVersionsSync(slug: string, currentTimestamp: number): Promise<number> {
  const subdir = getAvatarSubdir(slug);
  // Glob pattern: /data/avatars/{first-char}/{slug}*.png
  const pattern = `${AVATAR_ROOT}/${subdir}/${slug}*.png`;

  try {
    const files = await globToArray(pattern);
    let deletedCount = 0;

    for (const filePath of files) {
      const filename = basename(filePath);
      const fileSlug = extractSlugFromFilename(filename);

      // Verify this file actually belongs to our slug (not just prefix match)
      if (fileSlug !== slug) {
        continue;
      }

      const fileTimestamp = extractTimestampFromFilename(filename);
      // Skip the current version
      if (fileTimestamp === currentTimestamp) {
        continue;
      }

      // Delete legacy files (no timestamp) and old versions
      // Security: filePath comes from glob on a validated pattern (no path traversal)
      if (await tryDeleteFile(filePath, filename)) {
        deletedCount++;
        logger.debug({ slug, filename }, '[Avatar Sync] Deleted old version');
      }
    }

    return deletedCount;
  } catch (error) {
    const errCode = (error as NodeJS.ErrnoException).code;
    if (errCode === 'ENOENT') {
      return 0; // Directory doesn't exist yet
    }
    // Note: Throws on errors (fail-fast during startup), unlike cleanupOldAvatarVersions
    // which is called async during runtime and logs instead of throwing
    throw error;
  }
}

/** Batch size for cursor-based pagination (prevents OOM with large datasets) */
const SYNC_BATCH_SIZE = 100;

/** Result of syncing a single personality's avatar */
interface SyncResult {
  synced: boolean;
  cleanedCount: number;
}

/**
 * Sync a single personality's avatar to the filesystem
 *
 * @param personality - Personality data from database
 * @returns Sync result indicating if file was synced and how many old versions cleaned
 */
async function syncPersonalityAvatar(personality: {
  slug: string;
  avatarData: Uint8Array | null;
  updatedAt: Date;
}): Promise<SyncResult> {
  // Validate slug for safety
  if (!isValidSlug(personality.slug)) {
    logger.warn({ slug: personality.slug }, '[Avatar Sync] Skipping invalid slug');
    return { synced: false, cleanedCount: 0 };
  }

  const timestamp = personality.updatedAt.getTime();
  const avatarPath = getSafeAvatarPath(personality.slug, timestamp);

  // Safety check - getSafeAvatarPath validates the slug
  if (avatarPath === null) {
    logger.warn({ slug: personality.slug }, '[Avatar Sync] Invalid avatar path');
    return { synced: false, cleanedCount: 0 };
  }

  try {
    // Check if exact versioned file already exists
    await access(avatarPath);
    logger.debug({ slug: personality.slug, timestamp }, '[Avatar Sync] Versioned avatar exists');
    return { synced: false, cleanedCount: 0 };
  } catch {
    // File doesn't exist, create it from DB
  }

  // Skip if no avatar data (should not happen due to where clause, but TypeScript doesn't know)
  if (personality.avatarData === null) {
    return { synced: false, cleanedCount: 0 };
  }

  // Ensure subdirectory exists before writing
  await ensureAvatarDir(personality.slug);

  // avatarData is already raw bytes, just write to file
  const buffer = Buffer.from(personality.avatarData);
  await writeFile(avatarPath, buffer);

  // Cleanup old versions synchronously during startup
  const cleaned = await cleanupOldVersionsSync(personality.slug, timestamp);

  const sizeKB = (buffer.length / 1024).toFixed(2);
  logger.info(
    { slug: personality.slug, timestamp, sizeKB, cleanedVersions: cleaned },
    '[Avatar Sync] Synced avatar'
  );

  return { synced: true, cleanedCount: cleaned };
}

export async function syncAvatars(): Promise<void> {
  logger.info('[Avatar Sync] Starting avatar sync from database...');

  try {
    let syncedCount = 0;
    let skippedCount = 0;
    let cleanedCount = 0;
    let totalProcessed = 0;
    let cursor: string | undefined;

    // Use cursor-based pagination to prevent OOM with large datasets
    // Each batch loads avatarData for only SYNC_BATCH_SIZE personalities at a time
    do {
      const personalities = await prisma.personality.findMany({
        where: { avatarData: { not: null } },
        select: {
          id: true,
          slug: true,
          avatarData: true,
          updatedAt: true,
        },
        take: SYNC_BATCH_SIZE,
        ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
      });

      if (personalities.length === 0 && totalProcessed === 0) {
        logger.info('[Avatar Sync] No personalities with avatar data found');
        return;
      }

      for (const personality of personalities) {
        const result = await syncPersonalityAvatar(personality);
        if (result.synced) {
          syncedCount++;
          cleanedCount += result.cleanedCount;
        } else {
          skippedCount++;
        }
      }

      totalProcessed += personalities.length;

      // Set cursor for next batch (if there are more results)
      cursor =
        personalities.length === SYNC_BATCH_SIZE
          ? personalities[personalities.length - 1].id
          : undefined;
    } while (cursor !== undefined);

    logger.info(
      { synced: syncedCount, skipped: skippedCount, cleaned: cleanedCount, total: totalProcessed },
      '[Avatar Sync] Complete'
    );
  } catch (error) {
    logger.error({ err: error }, '[Avatar Sync] Failed to sync avatars');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
