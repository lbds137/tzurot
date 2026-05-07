/**
 * Character Chat — Random-Pick Helpers
 *
 * The `/character chat` subcommand makes the `character` argument optional.
 * When omitted, `resolveCharacterSlug` picks a random personality from the
 * user's accessible pool (matching the autocomplete scope: owned + public).
 * `finalizeDeferredReply` then either surfaces the pick to the channel or
 * cleans up the deferred "thinking..." reply for the explicit-pick path.
 */

import { createLogger, type LoadedPersonality } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { getCachedPersonalities } from '../../utils/autocomplete/autocompleteCache.js';
import { toGatewayUser } from '../../utils/userGatewayClient.js';

const logger = createLogger('character-random-pick');

/**
 * Result of resolving the character slug for a chat request.
 * Either a slug to load, or an error message to surface to the user.
 */
export type ResolvedSlug =
  | { kind: 'slug'; slug: string; randomPick: boolean }
  | { kind: 'error'; message: string };

/**
 * Resolve the character slug. If the user provided one, return it as-is.
 * If they didn't, pick a random personality from their accessible pool.
 */
export async function resolveCharacterSlug(
  providedSlug: string | null,
  context: DeferredCommandContext
): Promise<ResolvedSlug> {
  if (providedSlug !== null) {
    return { kind: 'slug', slug: providedSlug, randomPick: false };
  }

  const result = await getCachedPersonalities(toGatewayUser(context.user));
  if (result.kind === 'error') {
    // Log so a systematic gateway failure leaves a server-side trace; the
    // user-facing message alone gives no signal in Railway logs.
    logger.warn(
      { err: result.error, userId: context.user.id },
      'Personalities lookup failed during random-pick resolve'
    );
    return { kind: 'error', message: '❌ Unable to load characters. Please try again.' };
  }
  if (result.value.length === 0) {
    return {
      kind: 'error',
      message:
        '❌ No characters available to chat with. Use `/character create` to make one, or check that public characters exist.',
    };
  }
  // Index lands in [0, length-1] — Math.random() is half-open so floor() never
  // hits length itself; the length>0 guard above keeps the denominator safe.
  const picked = result.value[Math.floor(Math.random() * result.value.length)];
  return { kind: 'slug', slug: picked.slug, randomPick: true };
}

/**
 * Replace the deferred "thinking..." indicator with the appropriate signal
 * for the current pick mode.
 *
 * - Random pick: edit the deferred reply to surface who got chosen. The
 *   notice stays in the channel so participants can see the pick was random
 *   rather than directed.
 * - Explicit pick: delete the deferred reply. The brief invisible moment is
 *   preferable to a stale "thinking..." beside the user's message.
 */
export async function finalizeDeferredReply(
  context: DeferredCommandContext,
  personality: LoadedPersonality,
  isRandomPick: boolean
): Promise<void> {
  if (isRandomPick) {
    const pickedDisplayName = personality.displayName ?? personality.name;
    await context.editReply({ content: `🎲 Picked **${pickedDisplayName}** at random!` });
    return;
  }
  await context.deleteReply();
}
