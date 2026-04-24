/**
 * Memory command personality resolution helpers.
 *
 * Extracts the common resolve-personality-or-error-reply pattern
 * used across browse, search, stats, purge, and focus commands.
 */

import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import { type GatewayUser } from '../../utils/userGatewayClient.js';
import { resolvePersonalityId } from './autocomplete.js';

/**
 * Resolve an optional personality input to an ID.
 *
 * **Important contract**: on resolution failure, this function calls
 * `context.editReply` itself to surface the "not found" error to the
 * user, then returns `null`. Callers MUST return early when they see
 * `null` — sending a second reply via `editReply` would cause Discord
 * to reject the duplicate and the user would see "This interaction
 * failed." The error reply is handled here to centralize the
 * user-facing wording across browse, search, stats, purge, and focus.
 *
 * @returns one of:
 *   - `undefined` — input was null/empty, no filter to apply
 *   - `string` — resolved personality UUID
 *   - `null` — resolution failed; this function ALREADY sent an error
 *     reply via `context.editReply`, so the caller must return without
 *     sending any further reply
 */
export async function resolveOptionalPersonality(
  context: DeferredCommandContext,
  user: GatewayUser,
  personalityInput: string | null
): Promise<string | undefined | null> {
  if (personalityInput === null || personalityInput.length === 0) {
    return undefined;
  }

  if (isAutocompleteErrorSentinel(personalityInput)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return null;
  }

  const resolved = await resolvePersonalityId(user, personalityInput);
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
 * Same null-means-replied contract as {@link resolveOptionalPersonality}:
 * on failure, this function sends an error reply via `context.editReply`
 * and returns `null`. Callers MUST return early without sending any
 * further reply to avoid Discord's double-reply rejection.
 *
 * @returns The resolved personality UUID on success, or `null` if
 *   resolution failed (in which case the error reply has already been sent).
 */
export async function resolveRequiredPersonality(
  context: DeferredCommandContext,
  user: GatewayUser,
  personalityInput: string
): Promise<string | null> {
  if (isAutocompleteErrorSentinel(personalityInput)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return null;
  }

  const resolved = await resolvePersonalityId(user, personalityInput);
  if (resolved === null) {
    await context.editReply({
      content: `❌ Personality "${personalityInput}" not found. Use autocomplete to select a valid personality.`,
    });
  }
  return resolved;
}
