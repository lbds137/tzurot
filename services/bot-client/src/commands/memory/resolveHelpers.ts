/**
 * Memory command personality resolution helpers.
 *
 * Extracts the common resolve-personality-or-error-reply pattern
 * used across browse, search, stats, purge, and focus commands.
 */

import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { resolvePersonalityId } from './autocomplete.js';

/**
 * Resolve an optional personality input to an ID.
 *
 * @returns `undefined` if input is null/empty (no personality filter),
 *          the resolved ID string on success,
 *          or `null` if resolution failed (error reply already sent).
 */
export async function resolveOptionalPersonality(
  context: DeferredCommandContext,
  userId: string,
  personalityInput: string | null
): Promise<string | undefined | null> {
  if (personalityInput === null || personalityInput.length === 0) {
    return undefined;
  }

  const resolved = await resolvePersonalityId(userId, personalityInput);
  if (resolved === null) {
    await context.editReply({
      content: `❌ Personality "${personalityInput}" not found. Use autocomplete to select a valid personality.`,
    });
    return null;
  }

  return resolved;
}

/**
 * Resolve a required personality input to an ID.
 *
 * @returns The resolved ID string on success,
 *          or `null` if resolution failed (error reply already sent).
 */
export async function resolveRequiredPersonality(
  context: DeferredCommandContext,
  userId: string,
  personalityInput: string
): Promise<string | null> {
  const resolved = await resolvePersonalityId(userId, personalityInput);
  if (resolved === null) {
    await context.editReply({
      content: `❌ Personality "${personalityInput}" not found. Use autocomplete to select a valid personality.`,
    });
  }
  return resolved;
}
