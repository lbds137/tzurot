/**
 * Slug Utilities
 *
 * Functions for normalizing and generating character slugs.
 * Shared across services so both manual creation and imports
 * produce consistent slug formats.
 */

import crypto from 'crypto';

import { DISCORD_LIMITS } from '../constants/discord.js';
import { isBotOwner } from './ownerMiddleware.js';

/** Hex chars of the truncated-tail hash appended when a slug is too long. */
const SLUG_TAIL_HASH_LENGTH = 6;

/**
 * Fit `${base}${suffix}` within SLUG_MAX_LENGTH. When it already fits, returns it
 * unchanged (the common case). When it doesn't, truncates the base and appends a
 * short hash of the removed tail — so two long slugs sharing a prefix stay
 * distinct (no collision on the `slug` unique constraint) — then re-appends the
 * suffix. Guarantees the result is ≤ maxLength and still a valid slug/name.
 */
function fitSlugToMaxLength(base: string, suffix: string, maxLength: number): string {
  const combined = `${base}${suffix}`;
  if (combined.length <= maxLength) {
    return combined;
  }
  // Reserve room for the suffix + `-${hash}`; keep at least 1 base char. The
  // `max(1, …)` floor can only produce a result over maxLength if
  // `suffix.length > maxLength - (SLUG_TAIL_HASH_LENGTH + 1)` — impossible for real
  // callers (Discord usernames ≤32 → suffix ≤33, against maxLength 50/100). Revisit
  // this floor if ever reused with a much smaller cap or a longer suffix source.
  const baseBudget = Math.max(1, maxLength - suffix.length - (SLUG_TAIL_HASH_LENGTH + 1));
  // Truncate to the budget, then back off any trailing hyphens so we don't emit
  // `--hash`. Non-regex to avoid the super-linear-move lint on `-+$`.
  let keptEnd = Math.min(baseBudget, base.length);
  while (keptEnd > 0 && base[keptEnd - 1] === '-') {
    keptEnd--;
  }
  const kept = base.slice(0, keptEnd);
  const removedTail = base.slice(keptEnd);
  // Non-security disambiguation hash (collision avoidance, not a credential) —
  // SHA-256 mirrors attachmentCacheKey.ts; only the first few hex chars are used.
  const tailHash = crypto
    .createHash('sha256')
    .update(removedTail)
    .digest('hex')
    .slice(0, SLUG_TAIL_HASH_LENGTH);
  return `${kept}-${tailHash}${suffix}`;
}

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
 * @param slug - The base slug (or name) provided by the user
 * @param discordUserId - The Discord user ID
 * @param discordUsername - The Discord username
 * @param maxLength - Cap for the result. Defaults to the character-slug cap (50);
 *   callers in other domains (e.g. LLM/TTS config-name promotion, capped at 100)
 *   MUST pass their own limit so this doesn't force-fit the slug cap onto them.
 * @returns The normalized slug (possibly with username suffix, truncated to fit)
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
  discordUsername: string,
  maxLength: number = DISCORD_LIMITS.SLUG_MAX_LENGTH
): string {
  // Bot owner gets no suffix — but a long slug is still capped to maxLength.
  if (isBotOwner(discordUserId)) {
    return fitSlugToMaxLength(slug, '', maxLength);
  }

  // Regular users get username appended
  const sanitizedUsername = sanitizeUsernameForSlug(discordUsername);
  const suffix = sanitizedUsername.length === 0 ? `-${discordUserId}` : `-${sanitizedUsername}`;

  // Idempotent: if the slug is already suffixed for this user, don't re-append.
  // Without this, calling normalizeSlugForUser on a previously-normalized slug
  // would double-suffix (`lilith-bob` → `lilith-bob-bob`). Matters in update
  // paths where the input may already carry the suffix from a prior call.
  //
  // `endsWith` is a heuristic, not a provenance marker: a user who deliberately
  // types a slug ending in their own suffix (bob typing `mybob-bob`) is treated
  // as already-normalized. That false-positive is benign by construction —
  // only the CALLING user's suffix matches (Discord usernames are unique, so a
  // `-bob` tail always means bob authored it either way), collisions still hit
  // the DB unique constraint, and skipping the append is what the user wanted
  // (`mybob-bob`, not `mybob-bob-bob`). Tracking normalization out-of-band
  // would add schema surface for a failure mode with no damage vector.
  //
  // Split the existing suffix off and re-fit base+suffix (rather than fitting the
  // whole string with an empty suffix) so an over-length already-suffixed slug —
  // reachable via shapes imports, which don't length-cap before normalizing —
  // truncates only the BASE and keeps the `-username` provenance suffix intact,
  // exactly like the fresh-suffix path below.
  if (slug.endsWith(suffix)) {
    return fitSlugToMaxLength(slug.slice(0, -suffix.length), suffix, maxLength);
  }

  return fitSlugToMaxLength(slug, suffix, maxLength);
}
