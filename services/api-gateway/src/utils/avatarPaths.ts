/**
 * Avatar Path Utilities
 *
 * Centralized functions for safe avatar file path handling.
 * Implements defense-in-depth against path traversal attacks (CWE-22/23/36/73/99)
 *
 * Directory Structure:
 * /data/avatars/{first-char}/{slug}-{timestamp}.png
 *
 * Examples:
 * - /data/avatars/c/cold-1705827727111.png
 * - /data/avatars/m/my-personality-1705827727111.png
 * - /data/avatars/1/123bot-1705827727111.png
 *
 * The two-level structure reduces files per directory for better performance
 * when the number of personalities grows large (100+).
 *
 * Pattern:
 * 1. Validate slug format (alphanumeric, underscore, hyphen only)
 * 2. Derive subdirectory from first character (lowercased)
 * 3. Resolve path using path.resolve()
 * 4. Verify resolved path starts with expected root directory
 */

import { resolve, basename } from 'path';
import { unlink, mkdir, glob } from 'fs/promises';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('avatar-paths');

/** Root directory for avatar file storage */
export const AVATAR_ROOT = '/data/avatars';

/** Regex pattern for safe slug values (alphanumeric, underscore, hyphen only) */
const SAFE_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Regex pattern for path-versioned avatar filenames
 * Matches: {slug}-{timestamp}.png where timestamp is 13+ digits (milliseconds)
 *
 * Why 13+ digits: JavaScript timestamps (Date.getTime()) are 13 digits as of 2001
 * and will be 14 digits around year 2286. This threshold distinguishes timestamps
 * from version numbers in slugs like "avatar-v2.png" or "bot-123.png".
 *
 * Examples:
 * - "cold-1705827727111.png" -> captures "cold", timestamp 1705827727111
 * - "my-personality-1705827727111.png" -> captures "my-personality"
 * - "bot-v2.png" -> NOT matched (2 is not 13+ digits), falls through to legacy
 */
const VERSIONED_FILENAME_PATTERN = /^(.+)-(\d{13,})\.png$/;

/**
 * Regex pattern for legacy avatar filenames (no timestamp)
 * Matches: {slug}.png
 * Examples:
 * - "cold.png" -> captures "cold"
 * - "my-personality.png" -> captures "my-personality"
 */
const LEGACY_FILENAME_PATTERN = /^(.+)\.png$/;

/**
 * Extracts the personality slug from an avatar filename
 *
 * Supports two formats for Discord CDN cache-busting:
 * 1. Path-versioned: "{slug}-{timestamp}.png" -> returns "{slug}"
 * 2. Legacy: "{slug}.png" -> returns "{slug}"
 *
 * The timestamp is a 13+ digit number (milliseconds since epoch).
 * We match the longest possible timestamp to handle slugs containing hyphens.
 *
 * @param filename - The avatar filename (e.g., "cold-1705827727111.png" or "cold.png")
 * @returns The extracted slug, or null if the filename is invalid
 */
export function extractSlugFromFilename(filename: string): string | null {
  // Try path-versioned format first (with timestamp)
  const versionedMatch = VERSIONED_FILENAME_PATTERN.exec(filename);
  if (versionedMatch) {
    return versionedMatch[1];
  }

  // Fall back to legacy format (no timestamp)
  const legacyMatch = LEGACY_FILENAME_PATTERN.exec(filename);
  if (legacyMatch) {
    return legacyMatch[1];
  }

  return null;
}

/**
 * Extracts the timestamp from a versioned avatar filename
 *
 * @param filename - The avatar filename (e.g., "cold-1705827727111.png")
 * @returns The extracted timestamp as a number, or null if not a versioned filename
 */
export function extractTimestampFromFilename(filename: string): number | null {
  const versionedMatch = VERSIONED_FILENAME_PATTERN.exec(filename);
  if (versionedMatch) {
    return parseInt(versionedMatch[2], 10);
  }
  return null;
}

/**
 * Validates a slug is safe for use in file paths
 */
export function isValidSlug(slug: string): boolean {
  return SAFE_SLUG_PATTERN.test(slug);
}

/**
 * Gets the subdirectory name for a slug (first character, lowercased)
 *
 * Examples:
 * - "cold" -> "c"
 * - "MyBot" -> "m"
 * - "123bot" -> "1"
 * - "_special" -> "_"
 *
 * @param slug - The personality slug (must be valid)
 * @returns Single character subdirectory name
 */
export function getAvatarSubdir(slug: string): string {
  return slug[0].toLowerCase();
}

/**
 * Builds a safe avatar file path, or null if the slug is invalid
 *
 * Security: Validates slug pattern AND verifies resolved path stays within AVATAR_ROOT
 * This double-check prevents path traversal even if slug validation somehow fails
 *
 * Path format: /data/avatars/{first-char}/{slug}-{timestamp}.png
 *
 * @param slug - The personality slug
 * @param timestamp - Optional timestamp for versioned filenames (e.g., Date.getTime())
 * @returns Safe file path or null if validation fails
 */
export function getSafeAvatarPath(slug: string, timestamp?: number): string | null {
  // First layer: validate slug format
  if (!isValidSlug(slug)) {
    logger.debug({ slug }, 'Rejected invalid slug format');
    return null;
  }

  // Build filename - versioned if timestamp provided, legacy otherwise
  const filename = timestamp !== undefined ? `${slug}-${timestamp}.png` : `${slug}.png`;
  const subdir = getAvatarSubdir(slug);

  // Second layer: resolve and verify path stays within root
  const avatarPath = resolve(AVATAR_ROOT, subdir, filename);
  if (!avatarPath.startsWith(AVATAR_ROOT + '/')) {
    logger.warn({ slug, avatarPath }, 'Rejected avatar path outside root');
    return null;
  }

  return avatarPath;
}

/**
 * Ensures the avatar subdirectory exists for a slug
 *
 * Creates /data/avatars/{first-char}/ if it doesn't exist.
 * Safe to call multiple times (uses recursive: true).
 *
 * @param slug - The personality slug (must be valid)
 * @returns The subdirectory path, or null if slug is invalid
 */
export async function ensureAvatarDir(slug: string): Promise<string | null> {
  if (!isValidSlug(slug)) {
    return null;
  }

  const subdir = getAvatarSubdir(slug);
  const dirPath = resolve(AVATAR_ROOT, subdir);

  // Verify path is within root (defense in depth)
  if (!dirPath.startsWith(AVATAR_ROOT + '/')) {
    logger.warn({ slug, dirPath }, 'Rejected avatar directory outside root');
    return null;
  }

  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Safely deletes an avatar file by slug (legacy format only)
 *
 * @deprecated Use deleteAllAvatarVersions for complete cleanup
 * @param slug - The personality slug
 * @param logContext - Context string for logging (e.g., 'Personality delete', 'Avatar update')
 * @returns true if deleted, false if validation failed, null if file didn't exist
 */
export async function deleteAvatarFile(
  slug: string,
  logContext = 'Avatar'
): Promise<boolean | null> {
  const avatarPath = getSafeAvatarPath(slug);
  if (avatarPath === null) {
    return false;
  }

  try {
    await unlink(avatarPath);
    logger.info({ slug, avatarPath }, `[${logContext}] Deleted cached avatar file`);
    return true;
  } catch (error) {
    const errCode = (error as NodeJS.ErrnoException).code;
    // ENOENT = file doesn't exist, ENOTDIR = path component is not a directory
    if (errCode === 'ENOENT' || errCode === 'ENOTDIR') {
      logger.debug({ slug, errCode }, `[${logContext}] Avatar file not found, nothing to delete`);
      return null;
    }
    logger.warn({ err: error, avatarPath }, `[${logContext}] Failed to delete avatar file`);
    return false;
  }
}

/**
 * Attempts to delete a single avatar file, returning true on success
 * Silently ignores ENOENT (file already deleted)
 */
async function tryDeleteAvatarFile(filePath: string, logContext: string): Promise<boolean> {
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    const errCode = (error as NodeJS.ErrnoException).code;
    if (errCode !== 'ENOENT') {
      logger.warn({ err: error, filePath }, `[${logContext}] Failed to delete avatar file`);
    }
    return false;
  }
}

/** Maximum number of files to return from glob (prevents unbounded memory usage) */
const GLOB_RESULT_LIMIT = 1000;

/**
 * Collects files matching a glob pattern into an array
 *
 * Node.js fs.glob returns an AsyncIterable, this helper converts it to an array.
 * Limited to GLOB_RESULT_LIMIT files to prevent memory issues from runaway patterns.
 *
 * @param pattern - Glob pattern to match
 * @param limit - Maximum files to return (default: GLOB_RESULT_LIMIT)
 * @returns Array of matching file paths
 */
async function globToArray(pattern: string, limit = GLOB_RESULT_LIMIT): Promise<string[]> {
  const files: string[] = [];
  for await (const file of glob(pattern)) {
    if (files.length >= limit) {
      logger.warn({ pattern, limit }, '[Avatar glob] Result limit reached');
      break;
    }
    files.push(file);
  }
  return files;
}

/**
 * Cleans up old avatar versions for a slug, keeping only the current version
 *
 * Triggered on cache miss when a new avatar is fetched from DB. Called as
 * fire-and-forget (async, non-blocking) to avoid delaying the response.
 * Removes both legacy files ({slug}.png) and old versioned files.
 *
 * Uses glob to efficiently find files only for this slug's subdirectory,
 * avoiding full directory scans.
 *
 * @param slug - The personality slug
 * @param currentTimestamp - The timestamp of the version to keep
 * @returns Number of old versions deleted, or null if validation failed (already logged)
 */
export async function cleanupOldAvatarVersions(
  slug: string,
  currentTimestamp: number
): Promise<number | null> {
  if (!isValidSlug(slug)) {
    return null;
  }

  const subdir = getAvatarSubdir(slug);
  // Glob pattern: /data/avatars/{first-char}/{slug}*.png
  // This finds both versioned and legacy files for this slug
  // Security: slug is validated by isValidSlug (alphanumeric, underscore, hyphen only)
  // This prevents glob pattern injection (no *, ?, [, ], {, } characters allowed)
  const pattern = resolve(AVATAR_ROOT, subdir, `${slug}*.png`);

  try {
    const files = await globToArray(pattern);
    let deletedCount = 0;

    for (const filePath of files) {
      const filename = basename(filePath);
      const fileSlug = extractSlugFromFilename(filename);

      // Verify this file actually belongs to our slug (not just prefix match)
      // e.g., "cold*.png" might match "cold-bot.png" which has slug "cold-bot"
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
      if (await tryDeleteAvatarFile(filePath, 'Avatar cleanup')) {
        deletedCount++;
        logger.debug({ slug, filename }, '[Avatar cleanup] Deleted old version');
      }
    }

    if (deletedCount > 0) {
      logger.info(
        { slug, currentTimestamp, deletedCount },
        '[Avatar cleanup] Cleaned up old versions'
      );
    }
    return deletedCount;
  } catch (error) {
    const errCode = (error as NodeJS.ErrnoException).code;
    if (errCode === 'ENOENT') {
      // Avatar directory doesn't exist yet, nothing to clean
      return 0;
    }
    logger.warn({ err: error, slug }, '[Avatar cleanup] Failed to glob avatar directory');
    return null;
  }
}

/**
 * Deletes ALL avatar versions for a slug (versioned and legacy)
 *
 * Used when:
 * - A personality is deleted
 * - A personality's slug changes (need to clean up old slug's files)
 * - An avatar is updated (clear all old versions before new one is cached)
 *
 * Uses glob to efficiently find files only for this slug's subdirectory.
 *
 * @param slug - The personality slug
 * @param logContext - Context string for logging
 * @returns Number of files deleted, or null if validation failed (already logged)
 */
export async function deleteAllAvatarVersions(
  slug: string,
  logContext = 'Avatar'
): Promise<number | null> {
  if (!isValidSlug(slug)) {
    logger.debug({ slug }, `[${logContext}] Rejected invalid slug format`);
    return null;
  }

  const subdir = getAvatarSubdir(slug);
  // Glob pattern: /data/avatars/{first-char}/{slug}*.png
  // Security: slug is validated by isValidSlug (alphanumeric, underscore, hyphen only)
  // This prevents glob pattern injection (no *, ?, [, ], {, } characters allowed)
  const pattern = resolve(AVATAR_ROOT, subdir, `${slug}*.png`);

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

      // Security: filePath comes from glob on a validated pattern (no path traversal)
      if (await tryDeleteAvatarFile(filePath, logContext)) {
        deletedCount++;
        logger.debug({ slug, filename }, `[${logContext}] Deleted avatar version`);
      }
    }

    if (deletedCount > 0) {
      logger.info({ slug, deletedCount }, `[${logContext}] Deleted all avatar versions`);
    }
    return deletedCount;
  } catch (error) {
    const errCode = (error as NodeJS.ErrnoException).code;
    if (errCode === 'ENOENT') {
      // Avatar directory doesn't exist yet, nothing to delete
      return 0;
    }
    logger.warn({ err: error, slug }, `[${logContext}] Failed to glob avatar directory`);
    return null;
  }
}
