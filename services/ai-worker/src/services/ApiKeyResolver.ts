/**
 * API Key Resolver Service
 *
 * Handles BYOK (Bring Your Own Key) resolution for AI API calls.
 *
 * Security model:
 * - API keys are stored encrypted in the database (AES-256-GCM)
 * - Keys are decrypted only in ai-worker, never passed through Redis/BullMQ
 * - Hierarchical inheritance: user key → system fallback
 *
 * Usage:
 * ```typescript
 * const resolver = new ApiKeyResolver(prisma, 'your-encryption-key');
 * const apiKey = await resolver.resolveApiKey(userId, AIProvider.OpenRouter);
 * ```
 */

import { getConfig } from '@tzurot/common-types/config/config';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { decryptApiKey } from '@tzurot/common-types/utils/encryption';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';

const logger = createLogger('ApiKeyResolver');
const config = getConfig();

/**
 * Source of the API key
 * - 'user': User's own BYOK API key (full model access)
 * - 'system': System-provided API key (guest mode, free models only)
 */
export type ApiKeySource = 'user' | 'system';

/**
 * Result of API key resolution
 */
export interface ApiKeyResolutionResult {
  /** The resolved API key (decrypted) */
  apiKey: string;
  /** Source of the key */
  source: ApiKeySource;
  /** Provider the key is for */
  provider: AIProvider;
  /** User ID if resolved from user's wallet */
  userId?: string;
  /** Whether this user is in guest mode (no API key, free models only) */
  isGuestMode: boolean;
}

/**
 * Cache entry for API keys (to avoid repeated DB lookups)
 *
 * Note: Cache is local to each ai-worker instance. When users update/remove
 * their API keys via the API gateway, the ApiKeyCacheInvalidationService
 * publishes invalidation events via Redis pub/sub for instant cache
 * invalidation across all worker instances.
 */
/**
 * API Key Resolver - handles BYOK key lookup and decryption
 */
export class ApiKeyResolver {
  private prisma: PrismaClient;
  private encryptionKey: string;
  private readonly cache: TTLCache<ApiKeyResolutionResult>;

  constructor(
    prisma: PrismaClient,
    encryptionKey?: string,
    options?: {
      cacheTtlMs?: number;
      /** Test-only: inject a clock function for fake-timer compatibility with TTLCache. */
      now?: () => number;
    }
  ) {
    this.prisma = prisma;
    this.encryptionKey = encryptionKey ?? config.API_KEY_ENCRYPTION_KEY ?? '';
    this.cache = new TTLCache<ApiKeyResolutionResult>({
      ttl: options?.cacheTtlMs ?? INTERVALS.API_KEY_CACHE_TTL,
      now: options?.now,
    });

    if (this.encryptionKey.length === 0) {
      logger.warn(
        { component: 'ApiKeyResolver' },
        'API_KEY_ENCRYPTION_KEY not set - BYOK disabled, using system keys only'
      );
    }
  }

  /**
   * Resolve the API key to use for a request.
   *
   * Priority:
   * 1. User's API key for the provider (from database, decrypted)
   * 2. System API key (from environment variables)
   *
   * @param userId - The user making the request
   * @param provider - The AI provider (openrouter, openai, etc.)
   * @returns The resolved API key and its source
   * @throws Error if no API key is available
   */
  async resolveApiKey(
    userId: string | undefined,
    provider: AIProvider = AIProvider.OpenRouter
  ): Promise<ApiKeyResolutionResult> {
    // Check cache first
    const cacheKey = `${userId ?? 'system'}-${provider}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== null) {
      logger.debug({ userId, provider, source: 'cache' }, 'API key resolved from cache');
      return cached;
    }

    // Try to get user's API key if userId provided and encryption is configured
    if (userId !== undefined && userId.length > 0 && this.encryptionKey.length > 0) {
      const userKey = await this.getUserApiKey(userId, provider);
      if (userKey !== null) {
        const result: ApiKeyResolutionResult = {
          apiKey: userKey,
          source: 'user',
          provider,
          userId,
          isGuestMode: false,
        };
        this.cacheResult(cacheKey, result);
        logger.debug({ userId, provider, source: 'user' }, 'API key resolved from user wallet');
        return result;
      }
    }

    // Fall back to system API key - but restrict to free models (guest mode)
    // Users without their own BYOK key can only use free models on the system key
    const systemKey = this.getSystemApiKey(provider);
    if (systemKey !== null) {
      const result: ApiKeyResolutionResult = {
        apiKey: systemKey,
        source: 'system',
        provider,
        userId,
        isGuestMode: true, // Restrict to free models when using system key
      };
      this.cacheResult(cacheKey, result);
      logger.info(
        { userId, provider, source: 'system' },
        'Using system API key in Guest Mode (free models only)'
      );
      return result;
    }

    // No API key available at all - cannot make API calls
    throw new Error(
      `No API key available for provider ${provider}. ` +
        'Please configure your own API key or contact the bot administrator.'
    );
  }

  /**
   * Look up and decrypt a user's BYOK API key without falling back to the
   * system key. Returns `null` if the user has no key for the requested
   * provider OR encryption is disabled at the resolver level.
   *
   * Use this when callers want to know whether the user has a specific key
   * (e.g., ProviderRouter deciding whether to route z.ai-direct or fall through
   * to OpenRouter) — distinct from `resolveApiKey` which always returns
   * something or throws.
   */
  async tryResolveUserKey(
    userId: string | undefined,
    provider: AIProvider
  ): Promise<string | null> {
    if (userId === undefined || userId.length === 0) {
      return null;
    }
    if (this.encryptionKey.length === 0) {
      // Encryption not configured — every BYOK lookup returns null. Distinct
      // from "user has no key": a zai-coding preset always falls through to
      // OpenRouter in this branch, which is correct but worth surfacing when
      // diagnosing "why is my zai-coding preset not routing direct."
      logger.debug(
        { userId, provider },
        'Encryption key not configured — skipping user-key lookup'
      );
      return null;
    }

    // Peek the cache populated by resolveApiKey() before going to DB. Per-request
    // DB reads on the LLM hot path were exactly the cost the cache was added to
    // avoid; tryResolveUserKey() must respect it. Only honor cache hits where the
    // source was 'user' — system-source entries indicate "user has no key" and
    // should still return null here so ProviderRouter triggers fallthrough.
    const cacheKey = `${userId}-${provider}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== null) {
      if (cached.source === 'user') {
        logger.debug(
          { userId, provider, source: 'cache' },
          'User API key resolved from cache (tryResolveUserKey)'
        );
        return cached.apiKey;
      }
      // Cached as system-source → user has no key. Skip DB lookup.
      return null;
    }

    const userKey = await this.getUserApiKey(userId, provider);
    if (userKey !== null) {
      // Cache write for direct-route users — without this, requests that always
      // route via tryResolveUserKey (e.g., a user who only ever hits z.ai-coding
      // direct) would never populate the cache and DB-read on every request.
      // Mirror the cacheResult shape from resolveApiKey() so subsequent reads
      // through either entry-point hit the cache.
      this.cacheResult(`${userId}-${provider}`, {
        apiKey: userKey,
        source: 'user',
        provider,
        userId,
        isGuestMode: false,
      });
    }
    // Accepted overhead: when userKey is null (the auto-fallthrough path), we
    // do NOT cache a "no key" sentinel. Each `zai-coding`-with-no-key request
    // will re-read the DB on the cold-cache path. Synthesizing a system-source
    // entry here would muddy the cache semantics that resolveApiKey() depends
    // on (system entries imply "system fallback was used," which isn't true for
    // providers like zai-coding that have no system key). If usage scales to
    // the point where the per-request DB read becomes a hotspot, revisit by
    // introducing a distinct "no-user-key" cache state — see backlog.
    return userKey;
  }

  /**
   * Get and decrypt a user's API key from the database
   */
  private async getUserApiKey(userId: string, provider: AIProvider): Promise<string | null> {
    try {
      const userApiKey = await this.prisma.userApiKey.findFirst({
        where: {
          user: { discordId: userId },
          provider: provider,
          isActive: true,
        },
        select: {
          iv: true,
          content: true,
          tag: true,
        },
      });

      if (userApiKey === null) {
        return null;
      }

      // Decrypt the key (uses encryption key from environment via getEncryptionKey())
      return decryptApiKey({
        iv: userApiKey.iv,
        content: userApiKey.content,
        tag: userApiKey.tag,
      });
    } catch (error) {
      logger.error({ err: error, userId, provider }, 'Failed to retrieve/decrypt user API key');
      return null;
    }
  }

  /**
   * Get the system API key from environment variables
   */
  private getSystemApiKey(provider: AIProvider): string | null {
    switch (provider) {
      case AIProvider.OpenRouter:
        return config.OPENROUTER_API_KEY ?? null;
      case AIProvider.ElevenLabs:
        // System fallback key for ElevenLabs. In v1 this is BYOK-only —
        // no system key is typically configured. Present for completeness
        // and to support future operator-provided fallback if needed.
        return config.ELEVENLABS_API_KEY ?? null;
      case AIProvider.ZaiCoding:
        // No system fallback for z.ai Coding Plan — every user must bring
        // their own coding-plan subscription key. Callers wanting OpenRouter
        // fallthrough on missing z.ai key handle that at the routing layer
        // (see ProviderRouter.resolveRoute).
        return null;
      case AIProvider.Mistral:
        // No system fallback for Mistral — BYOK only. Users without a
        // configured Mistral key won't be able to use Mistral providers
        // (Voxtral TTS, Voxtral STT). The TtsDispatcher fallback chain
        // routes them to ElevenLabs or self-hosted instead.
        return null;
      default: {
        // Type guard for exhaustive check - add new providers above
        const _exhaustive: never = provider;
        void _exhaustive;
        return null;
      }
    }
  }

  /**
   * Cache an API key resolution result
   */
  private cacheResult(key: string, result: ApiKeyResolutionResult): void {
    this.cache.set(key, result);
  }

  /**
   * Invalidate cache for a user (call when they update their API keys)
   */
  invalidateUserCache(userId: string): void {
    this.cache.invalidateByPrefix(`${userId}-`);
    logger.debug({ userId }, 'Invalidated API key cache for user');
  }

  /**
   * Clear all cache entries
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Cleared API key cache');
  }
}
