/**
 * Avatar Path Utilities
 *
 * Centralized functions for safe avatar file path handling.
 * Implements defense-in-depth against path traversal attacks (CWE-22/23/36/73/99)
 *
 * Pattern:
 * 1. Validate slug format (alphanumeric, underscore, hyphen only)
 * 2. Resolve path using path.resolve()
 * 3. Verify resolved path starts with expected root directory
 */

import { resolve } from 'path';
import { unlink } from 'fs/promises';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('avatar-paths');

/** Root directory for avatar file storage */
export const AVATAR_ROOT = '/data/avatars';

/** Regex pattern for safe slug values (alphanumeric, underscore, hyphen only) */
const SAFE_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Regex pattern for path-versioned avatar filenames
 * Matches: {slug}-{timestamp}.png where timestamp is 13+ digits (milliseconds)
 * Examples:
 * - "cold-1705827727111.png" -> captures "cold"
 * - "my-personality-1705827727111.png" -> captures "my-personality"
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
 * Validates a slug is safe for use in file paths
 */
export function isValidSlug(slug: string): boolean {
  return SAFE_SLUG_PATTERN.test(slug);
}

/**
 * Builds a safe avatar file path, or null if the slug is invalid
 *
 * Security: Validates slug pattern AND verifies resolved path stays within AVATAR_ROOT
 * This double-check prevents path traversal even if slug validation somehow fails
 *
 * @param slug - The personality slug
 * @returns Safe file path or null if validation fails
 */
export function getSafeAvatarPath(slug: string): string | null {
  // First layer: validate slug format
  if (!isValidSlug(slug)) {
    logger.debug({ slug }, 'Rejected invalid slug format');
    return null;
  }

  // Second layer: resolve and verify path stays within root
  const avatarPath = resolve(AVATAR_ROOT, `${slug}.png`);
  if (!avatarPath.startsWith(AVATAR_ROOT + '/')) {
    logger.warn({ slug, avatarPath }, 'Rejected avatar path outside root');
    return null;
  }

  return avatarPath;
}

/**
 * Safely deletes an avatar file by slug
 *
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
