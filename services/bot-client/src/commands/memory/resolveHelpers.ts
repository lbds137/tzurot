/**
 * Memory command personality resolution helpers.
 *
 * Extracts the common resolve-personality-or-error-reply pattern
 * used across browse, search, stats, purge, and focus commands.
 */

import { escapeMarkdown } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import type { UserClient } from '@tzurot/clients';
import { resolvePersonalityId } from './autocomplete.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';

/**
 * Shared resolve-or-reply core. Maps a {@link ResolvedPersonality} to either the
 * UUID or a user-facing error reply (returning `null`). Distinguishes the two
 * failure shapes the infra-vs-negative fix introduced:
 *   - `not-found` → definitive "❌ Character X not found"
 *   - `unavailable` → "try again" ({@link AUTOCOMPLETE_UNAVAILABLE_MESSAGE}) —
 *     the personality list couldn't be fetched, so we must NOT claim the
 *     character doesn't exist.
 *
 * The `switch` is exhaustive by design: adding a new `ResolvedPersonality` kind
 * makes this fail to compile (no trailing return), forcing the caller wording
 * to be considered. Both wrappers below delegate here; they differ only in how
 * they treat empty input.
 */
async function resolveOrReply(
  context: DeferredCommandContext,
  userClient: UserClient,
  personalityInput: string
): Promise<string | null> {
  if (isAutocompleteErrorSentinel(personalityInput)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return null;
  }

  const resolved = await resolvePersonalityId(userClient, personalityInput);
  switch (resolved.kind) {
    case 'found':
      return resolved.id;
    case 'unavailable':
      await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
      return null;
    case 'not-found':
      await context.editReply({
        content: renderSpec(
          CATALOG.error.notFound('Character', {
            name: escapeMarkdown(personalityInput),
            autocomplete: true,
          })
        ),
      });
      return null;
    default: {
      // Exhaustiveness guard: a new ResolvedPersonality kind fails to compile here.
      const _exhaustive: never = resolved;
      return _exhaustive;
    }
  }
}

/**
 * Resolve an optional personality input to an ID.
 *
 * **Important contract**: on resolution failure, this function calls
 * `context.editReply` itself to surface the error to the user, then returns
 * `null`. Callers MUST return early when they see `null` — sending a second
 * reply via `editReply` would cause Discord to reject the duplicate and the user
 * would see "This interaction failed." The error reply is handled here to
 * centralize the user-facing wording across browse, search, stats, purge, and focus.
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
  userClient: UserClient,
  personalityInput: string | null
): Promise<string | undefined | null> {
  if (personalityInput === null || personalityInput.length === 0) {
    return undefined;
  }

  return resolveOrReply(context, userClient, personalityInput);
}

/**
 * Resolve a required personality input to an ID.
 *
 * Same null-means-replied contract as {@link resolveOptionalPersonality}:
 * on failure, this function sends an error reply via `context.editReply` and
 * returns `null`. The reply distinguishes a genuine miss ("not found") from an
 * infra failure ("try again") — see {@link resolveOrReply}. Callers MUST return
 * early on `null` without sending any further reply to avoid Discord's
 * double-reply rejection.
 *
 * @returns The resolved personality UUID on success, or `null` if resolution
 *   failed (in which case the error reply — "not found" or "try again" — has
 *   already been sent).
 */
export async function resolveRequiredPersonality(
  context: DeferredCommandContext,
  userClient: UserClient,
  personalityInput: string
): Promise<string | null> {
  return resolveOrReply(context, userClient, personalityInput);
}
