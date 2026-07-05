/**
 * VisionDescriptionCache
 * Redis-backed L1 cache for image vision-API outputs and negative-cache cooldowns.
 *
 * Two-tier layout (fixes the free-tier "can't reuse a paid model's description" bug):
 * - **Canonical success** (`vision:canon:{attachmentId|urlHash}`) — model-AGNOSTIC
 *   "best available" description. Every consumer reads this via `get()`, so a
 *   free-tier user is served a description a stronger (paid) model already
 *   produced. Writes go through a **tier-promotion** (`shouldPromoteCanonical`):
 *   a weaker model's description can never overwrite a stronger one's
 *   (`visionModelTier`), and a stale (>24h) or corrupt entry is replaced. 1h TTL.
 * - **Per-model failure** (`vision:fail:{model}:{…}`) — the negative cache is kept
 *   model-namespaced: it answers "has THIS model failed recently?" so a different
 *   (e.g. paid) model isn't blocked by a free model's failure and can still
 *   populate the canonical entry. Per-category cooldown via
 *   `VISION_FAILURE_CACHE_POLICY` (5min transient … 60min attachment-bound).
 *
 * Key derivation prefers the Discord attachment ID (stable snowflake) and falls
 * back to a query-stripped URL hash for embed images (`deriveAttachmentCacheKey`).
 *
 * History note: a PostgreSQL L2 layer existed prior to v3.0.0-beta.110 to survive
 * Redis restarts; removed because Discord attachments are ephemeral and a missing
 * TTL turned transient failures permanent. The legacy per-model success key
 * (`vision:` un-prefixed) is no longer written; those entries simply age out.
 */

import type { Redis } from 'ioredis';
import { TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import {
  VISION_FAILURE_CACHE_POLICY,
  type ApiErrorCategory,
} from '@tzurot/common-types/constants/error';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { deriveAttachmentCacheKey } from '@tzurot/common-types/utils/attachmentCacheKey';
import { createLogger } from '@tzurot/common-types/utils/logger';

import { visionModelTier, VISION_MODEL_TIER } from './multimodal/visionModelTier.js';

const logger = createLogger('VisionDescriptionCache');

/**
 * Beyond this age an existing canonical entry no longer blocks lower-tier writes.
 * Defensive only: entries carry a fresh `ts` per write and a 1h TTL, so a >24h
 * entry implies clock skew or an anomalous write — better replaced than defended.
 */
const MAX_CANONICAL_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Pure promotion decision for the canonical key: should a new description
 * (`newTier`, produced `nowMs`) overwrite the existing canonical `existing`?
 *
 * True when there is no entry, the entry is stale (older than MAX_CANONICAL_AGE),
 * or the new model's tier is >= the stored tier — so a weaker model can never
 * clobber a stronger model's description, but an equal/stronger one refreshes it.
 *
 * Extracted as a pure function so the promotion matrix is unit-testable without a
 * Lua-capable Redis. The store's read→decide→setex is not atomic, so two
 * concurrent stores for the SAME image race to last-writer-wins — rare (the
 * per-request describe flow means one describe per image at a time) and
 * low-impact (a lower-tier description survives at most one TTL cycle).
 */
export function shouldPromoteCanonical(
  existing: { tier: number; ts: number } | null,
  newTier: number,
  nowMs: number
): boolean {
  if (existing === null) {
    return true;
  }
  if (nowMs - existing.ts > MAX_CANONICAL_AGE_MS) {
    return true;
  }
  return newTier >= existing.tier;
}

/** Options for cache key generation */
interface VisionCacheKeyOptions {
  /** Discord attachment ID (stable, preferred) */
  attachmentId?: string;
  /** Image URL (fallback) */
  url: string;
  /**
   * Resolved vision model that produced (or will produce) the entry. Used for the
   * canonical tier (`visionModelTier`) and to namespace the per-model failure key.
   */
  model?: string;
}

/**
 * Options for storing a description (success path). `model` is REQUIRED here —
 * the canonical tier promotion derives dominance from it, and an absent model
 * would otherwise default to the strongest tier (`isFreeModel('') === false`),
 * letting an unknown-quality write clobber a genuine paid description. Making
 * it required fails that misuse at compile time instead.
 */
interface VisionStoreOptions extends VisionCacheKeyOptions {
  model: string;
}

/** Options for storing a vision failure */
interface VisionFailureOptions extends VisionCacheKeyOptions {
  /** Error category from `parseApiError`. TTL is selected via `VISION_FAILURE_CACHE_POLICY`. */
  category: ApiErrorCategory;
}

/** Cached failure entry returned from getFailure */
export interface VisionFailureEntry {
  /** Error category */
  category: ApiErrorCategory;
  /**
   * ISO timestamp of when this entry was cached — useful for diagnosing "how long has this been
   * poisoned." Optional because pre-deploy Redis entries lack this field; consumers should treat
   * a missing value as "unknown age" rather than "just now."
   */
  cachedAt?: string;
}

/** JSON shape of a canonical success entry. */
interface CanonicalEntry {
  description: string;
  /**
   * Model that produced it — observability/debugging ONLY (log fields). Never
   * feeds a decision, which is why `readCanonicalEntry` deliberately does not
   * validate it; promote it into the validated set if that ever changes.
   */
  model: string;
  /** `visionModelTier` of the producing model — drives promotion dominance. */
  tier: number;
  /** epoch ms — drives the MAX_CANONICAL_AGE staleness check. */
  ts: number;
}

export class VisionDescriptionCache {
  constructor(private redis: Redis) {}

  /**
   * Store a vision description in the model-agnostic canonical cache, tier-promoted
   * so a weaker model can't overwrite a stronger model's description.
   */
  async store(
    options: VisionStoreOptions,
    description: string,
    ttlSeconds: number = INTERVALS.VISION_DESCRIPTION_TTL
  ): Promise<void> {
    try {
      const key = this.getCanonicalKey(options);
      // Runtime backstop for the type-level guard: `model: ''` still satisfies
      // `string`, and `visionModelTier('')` would report PAID (the strongest tier).
      // An unknown-quality write must fail SAFE (lowest tier), not dominant.
      const tier =
        options.model.length > 0 ? visionModelTier(options.model) : VISION_MODEL_TIER.FREE;
      const now = Date.now();

      const existing = await this.readCanonicalEntry(key);
      if (!shouldPromoteCanonical(existing, tier, now)) {
        logger.debug(
          {
            attachmentId: options.attachmentId,
            model: options.model,
            tier,
            existingTier: existing?.tier,
          },
          '[VisionDescriptionCache] Skipped canonical write — a stronger/current description is cached'
        );
        return;
      }

      const entry: CanonicalEntry = { description, model: options.model, tier, ts: now };
      await this.redis.setex(key, ttlSeconds, JSON.stringify(entry));
      logger.debug(
        {
          attachmentId: options.attachmentId,
          model: options.model,
          tier,
          urlPrefix: options.url.substring(0, TEXT_LIMITS.URL_LOG_PREVIEW),
        },
        '[VisionDescriptionCache] Stored/promoted canonical description'
      );
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to store description');
    }
  }

  /** Read + parse the canonical entry; null on miss or corrupt JSON. */
  private async readCanonicalEntry(key: string): Promise<CanonicalEntry | null> {
    const raw = await this.redis.get(key);
    if (raw === null || raw.length === 0) {
      return null;
    }
    try {
      const entry = JSON.parse(raw) as Partial<CanonicalEntry>;
      if (
        typeof entry.description === 'string' &&
        typeof entry.tier === 'number' &&
        typeof entry.ts === 'number'
      ) {
        return entry as CanonicalEntry;
      }
      return null;
    } catch {
      // Corrupt JSON is a genuinely unexpected state — make it greppable rather
      // than silently treating it as a miss (consistent with the failure WARN).
      logger.warn({ key }, '[VisionDescriptionCache] Corrupt canonical entry — treating as absent');
      return null;
    }
  }

  /**
   * Get the model-agnostic canonical description (the best any model has produced
   * for this image). Returns the description string, or null on miss / corrupt entry.
   */
  async get(options: VisionCacheKeyOptions): Promise<string | null> {
    try {
      const entry = await this.readCanonicalEntry(this.getCanonicalKey(options));
      if (entry !== null && entry.description.length > 0) {
        logger.debug(
          { attachmentId: options.attachmentId, model: entry.model, tier: entry.tier },
          '[VisionDescriptionCache] Canonical HIT'
        );
        return entry.description;
      }
      logger.debug(
        { attachmentId: options.attachmentId },
        '[VisionDescriptionCache] Canonical MISS'
      );
      return null;
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to get description');
      return null;
    }
  }

  /**
   * Store a vision failure in the per-model negative cache.
   *
   * Kept model-namespaced: it answers "should THIS model retry?", so a free
   * model's failure doesn't block a paid model from describing the same image
   * and promoting a canonical success. TTL is per-category via
   * `VISION_FAILURE_CACHE_POLICY` (short cooldowns for transient failures, longer
   * for attachment-bound ones like a dead URL / content policy).
   */
  async storeFailure(options: VisionFailureOptions): Promise<void> {
    try {
      const key = this.getFailureKey(options);
      const ttlSeconds = VISION_FAILURE_CACHE_POLICY[options.category].l1TtlSeconds;
      const cachedAt = new Date().toISOString();
      const value = JSON.stringify({ category: options.category, cachedAt });

      await this.redis.setex(key, ttlSeconds, value);

      // WARN (not info): this is the single structured diagnostic for a vision failure
      // entering cached state — one greppable line answering "which model failed on
      // which attachment, why, and for how long" without reconstructing the request flow.
      logger.warn(
        {
          attachmentId: options.attachmentId,
          model: options.model,
          // No model → no tier claim: `visionModelTier('')` would report PAID (the
          // strongest tier) for an unknown model, and this WARN exists to be trusted.
          tier:
            options.model !== undefined && options.model.length > 0
              ? visionModelTier(options.model)
              : undefined,
          category: options.category,
          ttlSeconds,
          cachedAt,
        },
        '[VisionDescriptionCache] Stored failure in negative cache'
      );
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to store failure');
    }
  }

  /**
   * Check if a vision failure is cached for this (model, attachment).
   * Returns the entry on hit, null on miss / OK to retry.
   */
  async getFailure(options: VisionCacheKeyOptions): Promise<VisionFailureEntry | null> {
    try {
      const key = this.getFailureKey(options);
      const value = await this.redis.get(key);

      if (value === null || value.length === 0) {
        return null;
      }

      const entry = JSON.parse(value) as VisionFailureEntry;
      logger.debug(
        {
          attachmentId: options.attachmentId,
          model: options.model,
          category: entry.category,
          cachedAt: entry.cachedAt,
        },
        '[VisionDescriptionCache] Negative cache HIT'
      );
      return entry;
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to check failure cache');
      return null;
    }
  }

  /**
   * Model-AGNOSTIC canonical key: prefers the Discord attachment ID (stable
   * snowflake), falls back to a query-stripped URL hash. No model in the key —
   * that's the whole point (any model's description is reusable by any consumer).
   */
  private getCanonicalKey(options: VisionCacheKeyOptions): string {
    return deriveAttachmentCacheKey(REDIS_KEY_PREFIXES.VISION_CANONICAL, {
      id: options.attachmentId,
      url: options.url,
    });
  }

  /**
   * Per-model failure key (separate namespace from the canonical success cache).
   */
  private getFailureKey(options: VisionCacheKeyOptions): string {
    return deriveAttachmentCacheKey(
      this.prefixWithModel(REDIS_KEY_PREFIXES.VISION_FAILURE, options.model),
      {
        id: options.attachmentId,
        url: options.url,
      }
    );
  }

  /**
   * Namespace a key prefix by the resolved vision model so failure entries are
   * per-(attachment, model). The model is sanitized (only `[A-Za-z0-9._-]` survive)
   * so it can't introduce the `:` key delimiter. A missing model returns the bare prefix.
   */
  private prefixWithModel(prefix: string, model?: string): string {
    if (model === undefined || model.length === 0) {
      return prefix;
    }
    const safeModel = model.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Keep the trailing-colon contract deriveAttachmentCacheKey expects of prefixes.
    return `${prefix}${safeModel}:`;
  }
}
