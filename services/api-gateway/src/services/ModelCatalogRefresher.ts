/**
 * ModelCatalogRefresher
 *
 * Keeps the OpenRouter model catalog present in Redis on a schedule, rather
 * than as a side effect of someone browsing model config in Discord.
 *
 * Why this exists: `OpenRouterModelCache` is populated only by its own read
 * paths, and every one of those is request-driven (llm-config routes, model
 * overrides, autocomplete). ai-worker's `ModelCapabilityChecker` reads the same
 * Redis key on every generation but cannot populate it — it has no fetch path.
 * So a day with no model-config traffic expires the 24h key and nothing rewrites
 * it, leaving vision/reasoning gating and context-length clamps running on
 * pattern-matching guesses indefinitely. Observed in production: the key was
 * absent outright (`EXISTS 0`), not stale.
 *
 * The interval is deliberately well under the cache TTL so a failed refresh
 * cannot expire the catalog: at least TWO further attempts land strictly before
 * the current entry lapses. Pinned by "leaves room for two retries before the
 * cache TTL expires" in `ModelCatalogRefresher.test.ts`, which asserts the
 * ratio against the TTL constant rather than a literal.
 */

import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  createIntervalScheduler,
  type IntervalScheduler,
} from '@tzurot/common-types/utils/intervalScheduler';
import type { OpenRouterModelCache } from './OpenRouterModelCache.js';

const logger = createLogger('ModelCatalogRefresher');

/**
 * A third of the catalog's Redis TTL, so a refresh must fail twice in a row
 * before the key can lapse. Derived from the TTL rather than hardcoded: the two
 * are only safe as a ratio, and a TTL edit that left this behind would silently
 * reintroduce the expiry gap.
 *
 * A HALF-TTL interval looks sufficient and is not: the retry after a single
 * failure falls exactly ON the expiry instant, and since each tick's `setex`
 * lands only after its fetch completes, that retry's write actually trails the
 * expiry. A third buys a full interval of margin against ONE failure — the
 * retry lands at 2T/3, comfortably ahead of T.
 *
 * It does not make the boundary go away, only push it out: TWO consecutive
 * failures put the third attempt back at exactly T, the same case TTL/2 was
 * rejected for. That is the deliberate stopping point — each further division
 * buys one more tolerated failure at the cost of a proportional fetch-rate
 * increase, and two consecutive failures already means OpenRouter has been
 * unreachable for most of a day, which is TASK-650's alerting problem rather
 * than a cadence problem.
 */
export const CATALOG_REFRESH_INTERVAL_MS = (INTERVALS.OPENROUTER_MODELS_TTL * 1000) / 3;

/** Long enough to stay off the startup critical path, short enough that a cold deploy warms fast. */
const STARTUP_DELAY_MS = 10_000;

export function createModelCatalogRefresher(
  modelCache: Pick<OpenRouterModelCache, 'refreshFromSource'>
): IntervalScheduler<[]> {
  return createIntervalScheduler({
    intervalMs: CATALOG_REFRESH_INTERVAL_MS,
    startupDelayMs: STARTUP_DELAY_MS,
    logger,
    // Swallows its own errors by contract — the scheduler fires this unawaited,
    // so a rejection would surface as an unhandled rejection. A failed refresh
    // is survivable: the previous entry keeps serving until the next tick.
    run: async (): Promise<void> => {
      try {
        // refreshFromSource logs its own success line with the model count —
        // no second one here for the same event.
        await modelCache.refreshFromSource();
      } catch (err) {
        logger.error(
          { err },
          'Model catalog refresh failed — serving the previous entry until the next tick'
        );
      }
    },
  });
}
