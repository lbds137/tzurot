/**
 * Slug Utilities
 *
 * Functions for normalizing and generating character slugs.
 * Shared across services so both manual creation and imports
 * produce consistent slug formats.
 */

import { isBotOwner } from './ownerMiddleware.js';

/**
 * Sanitize a username for use in a slug
 * - Lowercase
 * - Replace non-alphanumeric characters with hyphens
 * - Remove consecutive hyphens
 * - Trim leading/trailing hyphens
 */
function sanitizeUsernameForSlug(username: string): string {
  return username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Normalize a slug for a user
 *
 * Bot owners get their slug as-is (no suffix).
 * Non-bot-owners get their username appended as a suffix.
 *
 * This prevents slug collisions between different users creating
 * characters with the same name.
 *
 * @param slug - The base slug provided by the user
 * @param discordUserId - The Discord user ID
 * @param discordUsername - The Discord username
 * @returns The normalized slug (possibly with username suffix)
 *
 * @example
 * // Bot owner creates "lilith"
 * normalizeSlugForUser('lilith', '123', 'lbds137') // => 'lilith'
 *
 * // Regular user creates "lilith"
 * normalizeSlugForUser('lilith', '456', 'cooluser') // => 'lilith-cooluser'
 */
export function normalizeSlugForUser(
  slug: string,
  discordUserId: string,
  discordUsername: string
): string {
  // Bot owner gets no suffix
  if (isBotOwner(discordUserId)) {
    return slug;
  }

  // Regular users get username appended
  const sanitizedUsername = sanitizeUsernameForSlug(discordUsername);
  if (sanitizedUsername.length === 0) {
    // Fallback to user ID if username sanitizes to empty string
    return `${slug}-${discordUserId}`;
  }

  return `${slug}-${sanitizedUsername}`;
}
