/**
 * Process-local cache in front of {@link resolveForwardedOrigin}.
 *
 * The extended-context window is re-fetched from Discord on EVERY turn, and a
 * forward sitting in that window costs up to two REST round-trips to attribute
 * (channel fetch + message fetch). Without a cache the same forward pays that
 * price once per turn, forever, for as long as it stays inside the window.
 *
 * Durability tier 1: recomputable for free (the resolver can always be re-run),
 * so losing the cache on restart is correctness-neutral.
 *
 * Keyed by the FORWARD message's own id, not the original's. That is safe
 * across viewers because the resolver's access-control viewer is
 * `message.author.id` — the forwarder — which is a fixed property of the
 * forward message itself, so two viewers can never share a key while
 * disagreeing about what they may see.
 *
 * Two tiers, mirroring `HttpPersonalityLoader`'s positive/negative split:
 * a resolved origin is stable and cached long; an unresolved one is cached
 * briefly.
 *
 * Accepted staleness, stated because the rest of this path is fussy about
 * access control: `authorPersonalityId` is produced by a real permission check,
 * and caching it means a personality deleted or made private mid-window keeps
 * rendering its `from_id` until the entry expires. Accepted rather than
 * overlooked — what leaks is a display name and an internal id inside a prompt,
 * never a capability, and re-resolving per turn would cost the Discord round
 * trips this cache exists to remove. The other fields cannot go stale at all:
 * an original's author and post time are immutable.
 */

import { type ForwardedOrigin } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';
import type { Message } from 'discord.js';
import {
  resolveForwardedOrigin,
  type ForwardedAuthorPersonalityResolver,
} from './forwardedMessageUtils.js';

const logger = createLogger('forwardedOriginCache');

/** A resolved origin does not change: the original's author and post time are immutable. */
const POSITIVE_TTL_MS = 60 * 60 * 1000;

/**
 * Unresolved forwards expire fast. A permanently-unresolvable forward (deleted
 * original, revoked access) must not re-fetch on every turn, but a transient
 * Discord failure must not suppress attribution for a whole hour either — five
 * minutes is the compromise between those two.
 */
const NEGATIVE_TTL_MS = 5 * 60 * 1000;

/** Forwards live in a bounded extended-context window; a few hundred entries covers it. */
const MAX_SIZE = 500;

/**
 * Upper bound on origin resolutions performed per extended-context fetch.
 * Each resolution is up to two Discord REST calls, and the window can hold up
 * to 100 messages — the cap keeps a forward-heavy channel from stalling a reply.
 */
export const MAX_FORWARD_ORIGIN_RESOLUTIONS_PER_FETCH = 10;

let positiveCache: TTLCache<ForwardedOrigin> | null = null;
let negativeCache: TTLCache<true> | null = null;

function positive(): TTLCache<ForwardedOrigin> {
  positiveCache ??= new TTLCache<ForwardedOrigin>({ ttl: POSITIVE_TTL_MS, maxSize: MAX_SIZE });
  return positiveCache;
}

function negative(): TTLCache<true> {
  negativeCache ??= new TTLCache<true>({ ttl: NEGATIVE_TTL_MS, maxSize: MAX_SIZE });
  return negativeCache;
}

/**
 * Resolve and cache the origins of a batch of forwarded messages, in parallel.
 *
 * Never throws and never rejects: each entry swallows its own error, because a
 * forward is context and losing its attribution must never cost the fetch.
 * Messages already cached (either tier) are skipped, so a steady-state window
 * performs no Discord calls at all.
 */
export async function primeForwardedOrigins(
  messages: Message[],
  resolveAuthorPersonalityId?: ForwardedAuthorPersonalityResolver
): Promise<void> {
  await Promise.all(
    messages.map(async msg => {
      if (positive().has(msg.id) || negative().has(msg.id)) {
        return;
      }
      try {
        const origin = await resolveForwardedOrigin(msg, resolveAuthorPersonalityId);
        if (origin === undefined) {
          negative().set(msg.id, true);
          return;
        }
        positive().set(msg.id, origin);
      } catch (error) {
        // resolveForwardedOrigin already fails open internally; this is the
        // belt-and-braces guard so one bad entry can't reject the Promise.all.
        logger.debug(
          { err: error, messageId: msg.id },
          'Failed to prime forwarded origin; quote stays unattributed'
        );
        negative().set(msg.id, true);
      }
    })
  );
}

/**
 * Read a previously-primed origin. Pure cache read — never triggers a fetch, so
 * a caller on the latency-sensitive conversion path adds zero network time.
 */
export function getCachedForwardedOrigin(messageId: string): ForwardedOrigin | undefined {
  return positive().get(messageId) ?? undefined;
}

/**
 * Reset both cache tiers. Test-only — lets each test exercise the cold path
 * without ordering dependencies on a prior test's populated cache.
 */
export function __resetForwardedOriginCacheForTests(): void {
  positiveCache = null;
  negativeCache = null;
}
