/**
 * Character Chat — Random-Pick Helpers
 *
 * The `/character chat` subcommand makes the `character` argument optional.
 * When omitted, `resolveCharacterSlug` picks a random personality from the
 * user's accessible pool (matching the autocomplete scope: owned + public).
 * `finalizeDeferredReply` then either surfaces the pick to the channel or
 * cleans up the deferred "thinking..." reply for the explicit-pick path.
 */

import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { getCachedPersonalities } from '../../utils/autocomplete/autocompleteCache.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('character-random-pick');

/**
 * Result of resolving the character slug for a chat request.
 * Either a slug to load, or an error message to surface to the user.
 */
export type ResolvedSlug =
  { kind: 'slug'; slug: string; randomPick: boolean } | { kind: 'error'; message: string };

export interface ResolveCharacterSlugOptions {
  /** When true and no slug was provided, exclude private personalities from the random pool. */
  excludePrivate?: boolean;
  /** When true and no slug was provided, restrict the random pool to user-owned personalities. */
  onlyMine?: boolean;
}

/**
 * Resolve the character slug. If the user provided one, return it as-is.
 * If they didn't, pick a random personality from their accessible pool.
 *
 * The pool is `getCachedPersonalities` — owned + public per the autocomplete
 * scope. Two independent filters compose as AND conjunctions:
 *  - `excludePrivate: true` drops private personalities (`isPublic === false`)
 *  - `onlyMine: true` drops personalities the user doesn't own (`isOwned === false`)
 * Combined, the pool becomes the user's owned-AND-public characters.
 */
export async function resolveCharacterSlug(
  providedSlug: string | null,
  context: DeferredCommandContext,
  options: ResolveCharacterSlugOptions = {}
): Promise<ResolvedSlug> {
  if (providedSlug !== null) {
    return { kind: 'slug', slug: providedSlug, randomPick: false };
  }

  const { userClient } = clientsFor(context.interaction);
  const result = await getCachedPersonalities(userClient);
  if (result.kind === 'error') {
    // Log so a systematic gateway failure leaves a server-side trace; the
    // user-facing message alone gives no signal in Railway logs.
    logger.warn(
      { err: result.error, userId: context.user.id },
      'Personalities lookup failed during random-pick resolve'
    );
    return {
      kind: 'error',
      message: renderSpec(
        classifyGatewayFailure(result.error, 'characters', { operation: 'read' })
      ),
    };
  }

  const excludePrivate = options.excludePrivate === true;
  const onlyMine = options.onlyMine === true;

  let candidates = result.value;
  if (onlyMine) {
    candidates = candidates.filter(p => p.isOwned);
  }
  if (excludePrivate) {
    candidates = candidates.filter(p => p.isPublic);
  }

  if (candidates.length === 0) {
    const activeFilters: string[] = [];
    if (onlyMine) {
      activeFilters.push('`only-mine`');
    }
    if (excludePrivate) {
      activeFilters.push('`exclude-private`');
    }

    const filterNoun = activeFilters.length > 1 ? 'filters active' : 'filter on';
    const filtersClause =
      activeFilters.length > 0 ? ` (${activeFilters.join(', ')} ${filterNoun})` : '';
    const suggestion =
      activeFilters.length > 0
        ? 'Adjust the filters or use `/character create` to make one.'
        : 'Use `/character create` to make one, or check that public characters exist.';
    return {
      kind: 'error',
      message: renderSpec(
        CATALOG.error.validation(
          `No characters available to chat with${filtersClause}. ${suggestion}`
        )
      ),
    };
  }
  // Index lands in [0, length-1] — Math.random() is half-open so floor() never
  // hits length itself; the length>0 guard above keeps the denominator safe.
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
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
