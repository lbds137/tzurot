/**
 * CloneCacheKernel — the shared clone-on-demand cache state machine for
 * voice providers.
 *
 * Every auto-cloning TTS provider needs the same three-cache interaction:
 * a positive TTL cache of cloned voice ids, a negative TTL cache of recent
 * failure reasons, and an inflight map deduplicating concurrent clone
 * attempts. The interaction is a miniature state machine with real bug
 * surface (a missed `.finally` permanently wedges dedup; negative-caching a
 * transient error locks a user out for the TTL) — so the kernel lives in ONE
 * place and providers keep only what genuinely diverges: the clone work
 * itself and the failure-classification predicate (which encodes each
 * provider's API semantics and stays with the provider by design — see the
 * 2-callback ceiling rule in `.claude/rules/02-code-standards.md`).
 *
 * Lifecycle concerns stay out: Mistral's eviction mutex serializes WHEN
 * `resolve` is called; the kernel neither knows nor cares.
 */

import { TTLCache } from '@tzurot/common-types/utils/TTLCache';

export interface CloneCacheKernelOptions {
  /** TTL for successful clone entries. */
  positiveTtlMs: number;
  /** TTL for negative (failure-reason) entries. */
  negativeTtlMs: number;
  /** Max entries per cache (LRU eviction). */
  maxSize: number;
}

export interface CloneResolveArgs {
  /** Cache key — typically `${slug}:${apiKeyDigest}`. */
  cacheKey: string;
  /**
   * Human-readable subject for the negative-hit error message, e.g.
   * `ElevenLabs voice clone for "my-slug"` — the kernel appends
   * `recently failed: <reason>`. A plain string, deliberately not a
   * callback (the 2-callback budget is spent on work + classifyFailure).
   */
  describe: string;
  /** Provider-specific clone flow; resolves to the final voice id. */
  work: () => Promise<string>;
  /**
   * Failure classifier — the provider owns the semantics entirely
   * (including any structured logging as a side effect). Return the reason
   * string to negative-cache, or null to let the error propagate uncached.
   */
  classifyFailure: (error: unknown, reason: string) => string | null;
}

export class CloneCacheKernel {
  private readonly positive: TTLCache<string>;
  private readonly negative: TTLCache<string>;
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(options: CloneCacheKernelOptions) {
    this.positive = new TTLCache<string>({
      ttl: options.positiveTtlMs,
      maxSize: options.maxSize,
    });
    this.negative = new TTLCache<string>({
      ttl: options.negativeTtlMs,
      maxSize: options.maxSize,
    });
  }

  /** Positive-cached voice id, or null. */
  getCached(cacheKey: string): string | null {
    return this.positive.get(cacheKey);
  }

  /** Whether a positive entry exists (eviction victim-selection support). */
  has(cacheKey: string): boolean {
    return this.positive.has(cacheKey);
  }

  /** Whether a clone attempt is currently inflight for the key. */
  hasInflight(cacheKey: string): boolean {
    return this.inflight.has(cacheKey);
  }

  /** Clear a stale failure record (e.g. after evicting its victim). */
  deleteNegative(cacheKey: string): void {
    this.negative.delete(cacheKey);
  }

  /** Drop both records for a key — the voice is gone or must re-clone. */
  invalidate(cacheKey: string): void {
    this.positive.delete(cacheKey);
    this.negative.delete(cacheKey);
  }

  /** Reset all state (tests, full-invalidation paths). */
  clear(): void {
    this.positive.clear();
    this.negative.clear();
    this.inflight.clear();
  }

  /**
   * The kernel state machine: positive hit → negative hit (throws with the
   * cached reason) → inflight dedup → run the work, classify any failure,
   * always clear inflight.
   */
  async resolve(args: CloneResolveArgs): Promise<string> {
    const { cacheKey, describe, work, classifyFailure } = args;

    const cached = this.positive.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const failReason = this.negative.get(cacheKey);
    if (failReason !== null) {
      throw new Error(`${describe} recently failed: ${failReason}`);
    }

    const existing = this.inflight.get(cacheKey);
    if (existing !== undefined) {
      return existing;
    }

    const promise = work()
      .then(voiceId => {
        this.positive.set(cacheKey, voiceId);
        return voiceId;
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        const toCache = classifyFailure(error, reason);
        if (toCache !== null) {
          this.negative.set(cacheKey, toCache);
        }
        throw error;
      })
      .finally(() => this.inflight.delete(cacheKey));

    this.inflight.set(cacheKey, promise);
    return promise;
  }
}
