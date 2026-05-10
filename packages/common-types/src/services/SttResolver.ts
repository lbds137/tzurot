/**
 * SttResolver
 *
 * Selects which STT backend should transcribe an audio attachment for a
 * given (user, personality) combination. Returns a provider enum value
 * plus the cascade source layer so callers can surface "Mistral (derived
 * from your TTS)" in the dashboard rather than a bare "Mistral".
 *
 * Cascade (most-specific → most-fallback):
 *
 *   1. user-personality   — UserPersonalityConfig.sttProviderId
 *   2. user-default       — User.defaultSttProviderId
 *   3. tts-derived        — IF resolved TTS provider is mistral|elevenlabs,
 *                            the same provider serves STT (one BYOK key
 *                            authorizes both audio directions)
 *   4. admin-default      — User.defaultProvider (the foundational baseline
 *                            written by /voice provider set)
 *   5. hardcoded          — voice-engine (self-hosted Parakeet TDT, free tier)
 *
 * NOT a {@link BaseConfigResolver} subclass: STT resolves a string enum
 * (provider choice), not a typed config row, and the 'tts-derived' layer
 * is a cross-resolver dependency that doesn't fit BaseConfigResolver's
 * personality-default contract. Caching, invalidation, and logging mirror
 * the base pattern though.
 *
 * **One-way dependency**: SttResolver READS from TtsConfigResolver but
 * is not READ FROM. Don't introduce a back-reference; if TTS ever needs
 * to know STT state, route through a higher coordinator.
 */

import { createLogger } from '../utils/logger.js';
import { TTLCache } from '../utils/TTLCache.js';
import { INTERVALS } from '../constants/timing.js';
import {
  isSttProvider,
  isByokAudioProvider,
  type SttProvider,
  type SttResolutionSource,
} from '../types/sttProvider.js';
import type { Logger } from 'pino';
import type { PrismaClient } from './prisma.js';
import type { TtsConfigResolver, LoadedTtsPersonality } from './TtsConfigResolver.js';

export interface SttResolutionResult {
  provider: SttProvider;
  source: SttResolutionSource;
}

/** Constructor options shared across cache-bearing resolvers. */
export interface SttResolverOptions {
  /** TTL for cache entries in milliseconds. Defaults to API_KEY_CACHE_TTL. */
  cacheTtlMs?: number;
  /**
   * Test-only clock injection so `vi.useFakeTimers()` advances the cache.
   * lru-cache's default `performance.now()` is not mocked by vitest fake timers.
   */
  now?: () => number;
}

/** Cascade source labels — extracted to avoid string-literal repetition. */
const SOURCE = {
  USER_PERSONALITY: 'user-personality',
  USER_DEFAULT: 'user-default',
  TTS_DERIVED: 'tts-derived',
  ADMIN_DEFAULT: 'admin-default',
  HARDCODED: 'hardcoded',
} as const satisfies Record<string, SttResolutionSource>;

const HARDCODED_FALLBACK: SttResolutionResult = Object.freeze({
  provider: 'voice-engine',
  source: SOURCE.HARDCODED,
});

/**
 * Internal STT context fetched in a single Prisma query. Holds the four
 * fields the cascade reads from User + UserPersonalityConfig.
 */
interface SttContext {
  defaultProvider: string | null;
  defaultSttProviderId: string | null;
  perPersonalitySttProviderId: string | null;
}

export class SttResolver {
  private readonly cache: TTLCache<SttResolutionResult>;
  private readonly logger: Logger;
  private readonly prisma: PrismaClient;
  private readonly ttsResolver: TtsConfigResolver;

  constructor(prisma: PrismaClient, ttsResolver: TtsConfigResolver, options?: SttResolverOptions) {
    this.prisma = prisma;
    this.ttsResolver = ttsResolver;
    this.logger = createLogger('SttResolver');
    this.cache = new TTLCache<SttResolutionResult>({
      ttl: options?.cacheTtlMs ?? INTERVALS.API_KEY_CACHE_TTL,
      now: options?.now,
    });
  }

  /**
   * Resolve the effective STT provider for a (user, personality) combination.
   * Always returns a usable provider — exhausts to `voice-engine` on any
   * error so transcription degrades to free tier rather than failing hard.
   */
  async resolveProvider(
    userId: string | undefined,
    personalityId: string,
    personality: LoadedTtsPersonality
  ): Promise<SttResolutionResult> {
    // Anonymous / system path → free tier directly. No DB lookup needed.
    if (userId === undefined || userId.length === 0) {
      return HARDCODED_FALLBACK;
    }

    const cacheKey = `${userId}-${personalityId}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    try {
      const ctx = await this.findSttContext(userId, personalityId);
      if (ctx === null) {
        // User row missing → fallback. Cache the result; the user appearing
        // later will trigger a per-user invalidation via the cache layer.
        this.cache.set(cacheKey, HARDCODED_FALLBACK);
        return HARDCODED_FALLBACK;
      }

      // Layer 1: per-personality STT override.
      const layer1 = this.narrow(ctx.perPersonalitySttProviderId);
      if (layer1 !== null) {
        return this.cacheAndReturn(cacheKey, { provider: layer1, source: SOURCE.USER_PERSONALITY });
      }

      // Layer 2: user-default STT.
      const layer2 = this.narrow(ctx.defaultSttProviderId);
      if (layer2 !== null) {
        return this.cacheAndReturn(cacheKey, { provider: layer2, source: SOURCE.USER_DEFAULT });
      }

      // Layer 3: TTS-derived. Only fires when the resolved TTS provider is
      // a BYOK audio provider (mistral / elevenlabs) — self-hosted TTS
      // doesn't imply self-hosted STT (different engines).
      const ttsResult = await this.ttsResolver.resolveConfig(userId, personalityId, personality);
      const ttsProvider = ttsResult.config.provider;
      if (isByokAudioProvider(ttsProvider)) {
        return this.cacheAndReturn(cacheKey, { provider: ttsProvider, source: SOURCE.TTS_DERIVED });
      }

      // Layer 4: admin default_provider (foundational baseline).
      const layer4 = this.narrow(ctx.defaultProvider);
      if (layer4 !== null) {
        return this.cacheAndReturn(cacheKey, { provider: layer4, source: SOURCE.ADMIN_DEFAULT });
      }

      // Layer 5: hardcoded voice-engine fallback.
      return this.cacheAndReturn(cacheKey, HARDCODED_FALLBACK);
    } catch (error) {
      this.logger.error(
        { err: error, userId, personalityId },
        'Failed to resolve STT provider, falling back to voice-engine'
      );
      // Don't cache the failure — a transient DB blip shouldn't poison
      // the cache for the full TTL window.
      return HARDCODED_FALLBACK;
    }
  }

  /**
   * Pure variant for "what would STT resolve to if TTS were X" comparisons —
   * used by the smart JIT footer on `/voice tts set`. Skips Layer 3's live
   * TtsConfigResolver call and instead consumes a caller-supplied TTS provider
   * to produce a deterministic answer (no cache, no race with the in-flight
   * TTS write).
   */
  async resolveProviderWithTtsHint(
    userId: string | undefined,
    personalityId: string,
    ttsProviderHint: string
  ): Promise<SttResolutionResult> {
    if (userId === undefined || userId.length === 0) {
      return HARDCODED_FALLBACK;
    }
    try {
      const ctx = await this.findSttContext(userId, personalityId);
      if (ctx === null) {
        return HARDCODED_FALLBACK;
      }
      const layer1 = this.narrow(ctx.perPersonalitySttProviderId);
      if (layer1 !== null) {
        return { provider: layer1, source: SOURCE.USER_PERSONALITY };
      }
      const layer2 = this.narrow(ctx.defaultSttProviderId);
      if (layer2 !== null) {
        return { provider: layer2, source: SOURCE.USER_DEFAULT };
      }
      if (isByokAudioProvider(ttsProviderHint)) {
        return { provider: ttsProviderHint, source: SOURCE.TTS_DERIVED };
      }
      const layer4 = this.narrow(ctx.defaultProvider);
      if (layer4 !== null) {
        return { provider: layer4, source: SOURCE.ADMIN_DEFAULT };
      }
      return HARDCODED_FALLBACK;
    } catch (error) {
      this.logger.error(
        { err: error, userId, personalityId, ttsProviderHint },
        'Failed to resolve STT provider with TTS hint'
      );
      return HARDCODED_FALLBACK;
    }
  }

  /**
   * Personality-less variant for the transcription path.
   *
   * Voice-message transcription happens BEFORE the bot knows which
   * personality will respond (a single voice clip may go to multiple
   * @mentioned personalities, or to none at all in a channel). The
   * cascade therefore drops Layer 1 (per-personality override) and
   * Layer 3 (TTS-derived — also needs personality):
   *
   *   Layer 2  user-default STT  → User.defaultSttProviderId
   *   Layer 4  admin-default     → User.defaultProvider
   *   Layer 5  hardcoded         → voice-engine
   *
   * Cached separately from {@link resolveProvider} to avoid contaminating
   * the per-personality cache with a personality-less entry.
   */
  async resolveProviderForTranscription(userId: string | undefined): Promise<SttResolutionResult> {
    if (userId === undefined || userId.length === 0) {
      return HARDCODED_FALLBACK;
    }

    const cacheKey = `${userId}-__transcription__`;
    const cached = this.cache.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    try {
      const user = await this.prisma.user.findFirst({
        where: { discordId: userId },
        select: { defaultProvider: true, defaultSttProviderId: true },
      });
      if (user === null) {
        this.cache.set(cacheKey, HARDCODED_FALLBACK);
        return HARDCODED_FALLBACK;
      }

      // Layer 2: user-default STT.
      const layer2 = this.narrow(user.defaultSttProviderId);
      if (layer2 !== null) {
        return this.cacheAndReturn(cacheKey, { provider: layer2, source: SOURCE.USER_DEFAULT });
      }

      // Layer 4: admin default_provider.
      const layer4 = this.narrow(user.defaultProvider);
      if (layer4 !== null) {
        return this.cacheAndReturn(cacheKey, { provider: layer4, source: SOURCE.ADMIN_DEFAULT });
      }

      // Layer 5: hardcoded voice-engine fallback.
      return this.cacheAndReturn(cacheKey, HARDCODED_FALLBACK);
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Failed to resolve STT provider for transcription, falling back to voice-engine'
      );
      return HARDCODED_FALLBACK;
    }
  }

  /** Invalidate every cache entry for a specific user. */
  invalidateUserCache(userId: string): void {
    this.cache.invalidateByPrefix(`${userId}-`);
    this.logger.debug({ userId }, 'Invalidated STT cache for user');
  }

  /** Clear the entire cache. */
  clearCache(): void {
    this.cache.clear();
  }

  // ===== Internals ==========================================================

  /**
   * Single-query fetch returning the four columns the cascade reads. Joins
   * UserPersonalityConfig.sttProviderId for the per-personality lookup so
   * the cascade doesn't need a second round-trip.
   */
  private async findSttContext(
    discordId: string,
    personalityId: string
  ): Promise<SttContext | null> {
    const user = await this.prisma.user.findFirst({
      where: { discordId },
      select: {
        defaultProvider: true,
        defaultSttProviderId: true,
        personalityConfigs: {
          where: { personalityId },
          select: { sttProviderId: true },
          take: 1,
        },
      },
    });
    if (user === null) {
      return null;
    }
    return {
      defaultProvider: user.defaultProvider,
      defaultSttProviderId: user.defaultSttProviderId,
      perPersonalitySttProviderId: user.personalityConfigs[0]?.sttProviderId ?? null,
    };
  }

  /** Narrow a raw DB string to a known SttProvider, or null when unset/invalid. */
  private narrow(raw: string | null): SttProvider | null {
    if (raw === null) {
      return null;
    }
    if (isSttProvider(raw)) {
      return raw;
    }
    // Defensive: a stale provider string in the DB (e.g., a provider we
    // dropped support for) shouldn't crash transcription. Log + skip the
    // layer so the cascade falls through to the next one.
    this.logger.warn({ raw }, 'Unknown STT provider string in DB — skipping cascade layer');
    return null;
  }

  private cacheAndReturn(cacheKey: string, result: SttResolutionResult): SttResolutionResult {
    this.cache.set(cacheKey, result);
    return result;
  }
}
