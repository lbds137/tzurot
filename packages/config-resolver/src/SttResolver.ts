/**
 * SttResolver
 *
 * Selects which STT backend should transcribe a user's audio. STT is
 * speaker-bound (your voice doesn't change per character), so the
 * resolution is user-scoped — no per-personality dimension.
 *
 * Cascade (most-specific → most-fallback):
 *
 *   1. user-default      — User.defaultSttProviderId (explicit /voice stt set)
 *   2. tts-derived       — IF user's default TTS provider is mistral|elevenlabs,
 *                           the same provider serves STT (one BYOK key handles
 *                           both audio directions)
 *   3. hardcoded         — voice-engine (self-hosted Parakeet TDT, free tier)
 *
 * Returns a {@link SttResolutionResult} carrying both provider AND source
 * layer so callers can render attribution like "Mistral (matches your TTS
 * choice)" in dashboards.
 */

import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  isSttProvider,
  isByokAudioProvider,
  type SttProvider,
  type SttResolutionSource,
} from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';
import type { Logger } from 'pino';

export interface SttResolutionResult {
  provider: SttProvider;
  source: SttResolutionSource;
}

export interface SttResolverOptions {
  /** TTL for cache entries in milliseconds. Defaults to API_KEY_CACHE_TTL. */
  cacheTtlMs?: number;
  /** Test-only clock injection so vi.useFakeTimers() advances the cache. */
  now?: () => number;
}

const SOURCE = {
  USER_DEFAULT: 'user-default',
  TTS_DERIVED: 'tts-derived',
  HARDCODED: 'hardcoded',
} as const satisfies Record<string, SttResolutionSource>;

const HARDCODED_FALLBACK: SttResolutionResult = Object.freeze({
  provider: 'voice-engine',
  source: SOURCE.HARDCODED,
});

/** Internal context fetched in a single Prisma query for the cascade. */
interface SttContext {
  defaultSttProviderId: string | null;
  defaultTtsProvider: string | null;
}

export class SttResolver {
  private readonly cache: TTLCache<SttResolutionResult>;
  private readonly logger: Logger;
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient, options?: SttResolverOptions) {
    this.prisma = prisma;
    this.logger = createLogger('SttResolver');
    this.cache = new TTLCache<SttResolutionResult>({
      ttl: options?.cacheTtlMs ?? INTERVALS.API_KEY_CACHE_TTL,
      now: options?.now,
    });
  }

  /**
   * Resolve the STT provider for a user. Always returns a usable provider —
   * exhausts to voice-engine on any error so transcription degrades to free
   * tier rather than failing hard.
   */
  async resolveProvider(userId: string | undefined): Promise<SttResolutionResult> {
    if (userId === undefined || userId.length === 0) {
      return HARDCODED_FALLBACK;
    }

    const cached = this.cache.get(userId);
    if (cached !== null) {
      return cached;
    }

    try {
      const ctx = await this.findSttContext(userId);
      if (ctx === null) {
        // User row missing → fallback. Cache so a repeat lookup short-circuits.
        this.cache.set(userId, HARDCODED_FALLBACK);
        return HARDCODED_FALLBACK;
      }

      return this.cacheAndReturn(userId, this.applyCascade(ctx));
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Failed to resolve STT provider, falling back to voice-engine'
      );
      // Don't cache the failure — a transient DB blip shouldn't poison
      // the cache for the full TTL window.
      return HARDCODED_FALLBACK;
    }
  }

  /** Invalidate the cache entry for a specific user. */
  invalidateUserCache(userId: string): void {
    this.cache.delete(userId);
    this.logger.debug({ userId }, 'Invalidated STT cache for user');
  }

  /** Clear the entire cache. */
  clearCache(): void {
    this.cache.clear();
  }

  // ===== Internals ==========================================================

  private applyCascade(ctx: SttContext): SttResolutionResult {
    // Layer 1: user-default STT (explicit override).
    const layer1 = this.narrow(ctx.defaultSttProviderId);
    if (layer1 !== null) {
      return { provider: layer1, source: SOURCE.USER_DEFAULT };
    }

    // Layer 2: TTS-derived. Only fires for BYOK audio providers
    // (mistral / elevenlabs) — self-hosted TTS doesn't imply self-hosted
    // STT (Pocket TTS and Parakeet TDT are different engines).
    if (ctx.defaultTtsProvider !== null && isByokAudioProvider(ctx.defaultTtsProvider)) {
      return { provider: ctx.defaultTtsProvider, source: SOURCE.TTS_DERIVED };
    }

    // Layer 3: hardcoded voice-engine fallback.
    return HARDCODED_FALLBACK;
  }

  /**
   * Single-query fetch: user's STT override + the provider of their default
   * TTS config (joined for the tts-derived layer). Returns null for unknown
   * users; `defaultTtsProvider` is null when the user has no default TTS set.
   */
  private async findSttContext(discordId: string): Promise<SttContext | null> {
    const user = await this.prisma.user.findFirst({
      where: { discordId },
      select: {
        defaultSttProviderId: true,
        defaultTtsConfig: { select: { provider: true } },
      },
    });
    if (user === null) {
      return null;
    }
    return {
      defaultSttProviderId: user.defaultSttProviderId,
      defaultTtsProvider: user.defaultTtsConfig?.provider ?? null,
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
    // Defensive: a stale string in the DB shouldn't crash transcription.
    // Log + skip the layer so the cascade falls through.
    this.logger.warn({ raw }, 'Unknown STT provider string in DB — skipping cascade layer');
    return null;
  }

  private cacheAndReturn(cacheKey: string, result: SttResolutionResult): SttResolutionResult {
    this.cache.set(cacheKey, result);
    return result;
  }
}
