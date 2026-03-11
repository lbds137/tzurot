/**
 * ElevenLabs Voice Service
 *
 * Manages auto-cloned ElevenLabs voices for BYOK users. Mirrors the
 * VoiceRegistrationService pattern: lazy voice cloning from reference audio,
 * in-memory TTL cache, negative cache, and in-flight dedup.
 *
 * Voice lifecycle:
 * 1. First TTS for personality slug: fetch reference audio from gateway,
 *    clone via ElevenLabs /v1/voices/add → cache voice_id
 * 2. Subsequent TTS: return cached voice_id (30-min TTL)
 * 3. Cache miss after expiry: list user's voices → find by name → re-cache
 *    (no re-clone — cloned voices persist in ElevenLabs account)
 *
 * Voice naming: "tzurot-{slug}" — identifiable in ElevenLabs dashboard.
 */

import { createLogger, TTLCache, ELEVENLABS_VOICE_NAME_PREFIX } from '@tzurot/common-types';
import {
  elevenLabsCloneVoice,
  elevenLabsListVoices,
  elevenLabsDeleteVoice,
  ElevenLabsApiError,
} from './ElevenLabsClient.js';
import type { ElevenLabsVoiceInfo } from './ElevenLabsClient.js';
import { fetchVoiceReference } from './voiceReferenceHelper.js';

const logger = createLogger('ElevenLabsVoiceService');

/** TTL for successful clone cache entries (30 minutes) */
const CLONE_CACHE_TTL_MS = 30 * 60 * 1000;
/** TTL for failed clone cache entries (5 minutes) */
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;
/** Max cached entries */
const CACHE_MAX_SIZE = 200;

interface CachedVoice {
  voiceId: string;
}

interface EvictAndCloneOptions {
  slug: string;
  apiKey: string;
  cacheKey: string;
  voices: ElevenLabsVoiceInfo[];
  voiceName: string;
  audioBuffer: Buffer;
  contentType: string;
}

export class ElevenLabsVoiceService {
  private readonly cloneCache: TTLCache<CachedVoice>;
  private readonly negativeCache: TTLCache<string>;
  private readonly inflight = new Map<string, Promise<string>>();

  constructor() {
    this.cloneCache = new TTLCache<CachedVoice>({
      ttl: CLONE_CACHE_TTL_MS,
      maxSize: CACHE_MAX_SIZE,
    });
    this.negativeCache = new TTLCache<string>({
      ttl: NEGATIVE_CACHE_TTL_MS,
      maxSize: CACHE_MAX_SIZE,
    });
  }

  /**
   * Ensure a voice is cloned for the given personality slug.
   *
   * @returns The ElevenLabs voice_id to use for TTS
   * @throws Error if reference audio cannot be fetched or clone fails
   */
  async ensureVoiceCloned(slug: string, apiKey: string): Promise<string> {
    const cacheKey = this.buildCacheKey(slug, apiKey);

    // Check positive cache
    const cached = this.cloneCache.get(cacheKey);
    if (cached !== null) {
      return cached.voiceId;
    }

    // Check negative cache
    const failReason = this.negativeCache.get(cacheKey);
    if (failReason !== null) {
      throw new Error(`ElevenLabs voice clone for "${slug}" recently failed: ${failReason}`);
    }

    // Deduplicate concurrent clone attempts
    const existing = this.inflight.get(cacheKey);
    if (existing !== undefined) {
      return existing;
    }

    const promise = this.doEnsureCloned(slug, apiKey, cacheKey)
      .catch(error => {
        const reason = error instanceof Error ? error.message : String(error);

        // Rate limit (429) is transient — don't negatively cache
        if (error instanceof ElevenLabsApiError && error.isRateLimited) {
          logger.warn({ slug, reason }, 'ElevenLabs voice clone rate limited (not cached)');
        } else {
          this.negativeCache.set(cacheKey, reason);
          logger.warn({ slug, reason }, 'ElevenLabs voice clone failed — cached for 5 min');
        }

        throw error;
      })
      .finally(() => this.inflight.delete(cacheKey));

    this.inflight.set(cacheKey, promise);
    return promise;
  }

  private async doEnsureCloned(slug: string, apiKey: string, cacheKey: string): Promise<string> {
    const voiceName = `${ELEVENLABS_VOICE_NAME_PREFIX}${slug}`;

    // 1. List voices → find existing → cache & return
    let voices: ElevenLabsVoiceInfo[] = [];
    try {
      voices = await elevenLabsListVoices(apiKey);
      const existing = voices.find(v => v.name === voiceName);
      if (existing !== undefined) {
        this.cloneCache.set(cacheKey, { voiceId: existing.voiceId });
        logger.info({ slug, voiceId: existing.voiceId }, 'Found existing ElevenLabs voice');
        return existing.voiceId;
      }
    } catch (error) {
      logger.warn({ err: error, slug }, 'Failed to list ElevenLabs voices, attempting clone');
    }

    // 2. Fetch reference audio from api-gateway
    const { audioBuffer, contentType } = await fetchVoiceReference(slug);

    // 3. Clone — with eviction fallback on voice limit error
    try {
      logger.info({ slug, audioSize: audioBuffer.length }, 'Cloning voice via ElevenLabs');
      const { voiceId } = await elevenLabsCloneVoice({
        name: voiceName,
        audioBuffer,
        contentType,
        apiKey,
        description: `Auto-cloned by Tzurot for personality "${slug}"`,
      });

      this.cloneCache.set(cacheKey, { voiceId });
      logger.info({ slug, voiceId }, 'ElevenLabs voice cloned and cached');
      return voiceId;
    } catch (error) {
      if (error instanceof ElevenLabsApiError && error.isVoiceLimitError) {
        logger.warn({ slug }, 'Voice slot limit reached, attempting eviction');
        return this.evictAndClone({
          slug,
          apiKey,
          cacheKey,
          voices,
          voiceName,
          audioBuffer,
          contentType,
        });
      }
      throw error;
    }
  }

  /**
   * Evict a stale tzurot-prefixed voice and retry the clone.
   *
   * Eviction candidates: tzurot-prefixed voices NOT in the warm clone cache
   * (recently used) and NOT in the inflight map (mid-clone). This is
   * approximate LRU — warm voices survive, cold voices get evicted.
   */
  private async evictAndClone(opts: EvictAndCloneOptions): Promise<string> {
    const { slug, apiKey, cacheKey, voices, voiceName, audioBuffer, contentType } = opts;
    const keySuffix = this.getKeySuffix(apiKey);

    const candidates = voices.filter(v => {
      if (!v.name.startsWith(ELEVENLABS_VOICE_NAME_PREFIX)) {
        return false;
      }
      if (v.name === voiceName) {
        return false;
      }
      const candidateSlug = v.name.slice(ELEVENLABS_VOICE_NAME_PREFIX.length);
      const candidateKey = `${candidateSlug}:${keySuffix}`;
      return !this.cloneCache.has(candidateKey) && !this.inflight.has(candidateKey);
    });

    if (candidates.length === 0) {
      throw new Error(
        `No evictable voices found for "${slug}" — all tzurot voices are in active use`
      );
    }

    const victim = candidates[0];
    logger.info(
      { slug, evictedVoice: victim.name, evictedVoiceId: victim.voiceId },
      'Evicting stale voice to free slot'
    );

    await elevenLabsDeleteVoice(victim.voiceId, apiKey);

    // Clear any stale cache entry for the evicted voice
    const victimSlug = victim.name.slice(ELEVENLABS_VOICE_NAME_PREFIX.length);
    this.cloneCache.delete(`${victimSlug}:${keySuffix}`);

    // Retry clone
    const { voiceId } = await elevenLabsCloneVoice({
      name: voiceName,
      audioBuffer,
      contentType,
      apiKey,
      description: `Auto-cloned by Tzurot for personality "${slug}"`,
    });

    this.cloneCache.set(cacheKey, { voiceId });
    logger.info({ slug, voiceId, evictedVoice: victim.name }, 'Voice cloned after eviction');
    return voiceId;
  }

  /** Build a cache key that includes the API key suffix (different users = different entries) */
  private buildCacheKey(slug: string, apiKey: string): string {
    return `${slug}:${this.getKeySuffix(apiKey)}`;
  }

  /**
   * Extract a fingerprint from the API key for cache key differentiation.
   * Uses first 4 + last 8 characters (12 total) to minimize collision risk
   * while keeping cache keys short and the full key out of log output.
   * Not a security boundary — the raw key is already in process memory.
   *
   * Assumes keys are at least 12 chars (ElevenLabs keys are ~32+ chars).
   * For shorter keys the slices overlap, producing a longer-than-12-char
   * suffix — still unique, just not optimally compact.
   */
  private getKeySuffix(apiKey: string): string {
    return `${apiKey.slice(0, 4)}${apiKey.slice(-8)}`;
  }

  /**
   * Invalidate cached voice for a specific slug + API key.
   * Used by TTSStep when ElevenLabs returns 404 (voice deleted externally)
   * to force re-cloning on the next ensureVoiceCloned() call.
   */
  invalidateVoice(slug: string, apiKey: string): void {
    const cacheKey = this.buildCacheKey(slug, apiKey);
    this.cloneCache.delete(cacheKey);
    this.negativeCache.delete(cacheKey);
  }

  /** Clear all caches (for testing). */
  clearCache(): void {
    this.cloneCache.clear();
    this.negativeCache.clear();
    this.inflight.clear();
  }
}
