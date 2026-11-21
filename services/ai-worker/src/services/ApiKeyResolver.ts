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
 * const resolver = new ApiKeyResolver(prisma); // reads API_KEY_ENCRYPTION_KEY from the env
 * const apiKey = await resolver.resolveApiKey(userId, AIProvider.OpenRouter);
 * ```
 */

import { getConfig } from '@tzurot/common-types/config/config';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { decryptApiKey, isEncryptionConfigured } from '@tzurot/common-types/utils/encryption';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { undecryptableApiKeyMessage } from '@tzurot/common-types/utils/providerDisplayName';
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
 * Thrown by {@link ApiKeyResolver.resolveApiKey} when no key is configured
 * anywhere for the requested provider — neither a user BYOK key nor a system
 * fallback. This is an EXPECTED outcome for BYOK-only providers (Mistral,
 * z.ai coding, ElevenLabs without an operator key): callers treat it as
 * control flow (fall back to another provider) rather than as an incident,
 * so it must be distinguishable from a genuine resolution failure such as an
 * {@link UndecryptableApiKeyError} or an {@link EncryptionMisconfiguredError}.
 */
export class NoApiKeyAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoApiKeyAvailableError';
  }
}

/**
 * Thrown when a user's stored BYOK key exists but will not decrypt while the
 * service's encryption config is healthy (a corrupt or foreign-key row). The
 * message IS the user-facing re-enter copy; the generation pipeline fails the
 * job with it instead of silently demoting the user to guest mode.
 */
export class UndecryptableApiKeyError extends Error {
  readonly provider: AIProvider;

  constructor(provider: AIProvider, options?: { cause?: unknown }) {
    super(undecryptableApiKeyMessage(provider), options);
    this.name = 'UndecryptableApiKeyError';
    this.provider = provider;
  }
}

/**
 * Thrown when a stored row fails to decrypt AND `isEncryptionConfigured()` is
 * false — the SERVICE's encryption env is malformed, or set differently from the
 * key injected into this resolver. A deploy bug, not a user problem.
 * `isEncryptionConfigured()` is also false when `API_KEY_ENCRYPTION_KEY_PREVIOUS`
 * is set but malformed during a rotation window, so that classifies here too
 * (a real deploy fault).
 * A fully UNSET key is NOT covered here: the resolver then holds an empty key,
 * skips the user lookup and serves guest mode, so this error is never thrown.
 * That gap is tracked as TASK-1488.
 * Keeps the underlying message (which names the env var) and must never be
 * rendered as the user's re-enter copy or absorbed into guest mode.
 */
export class EncryptionMisconfiguredError extends Error {
  constructor(options?: { cause?: unknown }) {
    const cause = options?.cause;
    super(cause instanceof Error ? cause.message : 'Encryption is not configured', options);
    this.name = 'EncryptionMisconfiguredError';
  }
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
  private readonly cache: TTLCache<ApiKeyResolutionResult>;

  constructor(
    prisma: PrismaClient,
    options?: {
      cacheTtlMs?: number;
      /** Test-only: inject a clock function for fake-timer compatibility with TTLCache. */
      now?: () => number;
    }
  ) {
    this.prisma = prisma;
    this.cache = new TTLCache<ApiKeyResolutionResult>({
      ttl: options?.cacheTtlMs ?? INTERVALS.API_KEY_CACHE_TTL,
      now: options?.now,
    });

    // Same source decryption reads (process.env), so the warn cannot disagree with it.
    if (!isEncryptionConfigured()) {
      logger.warn(
        { component: 'ApiKeyResolver' },
        'API_KEY_ENCRYPTION_KEY (or API_KEY_ENCRYPTION_KEY_PREVIOUS) missing or malformed - any stored BYOK key will fail loudly (EncryptionMisconfiguredError); users without a key use the system key as guests'
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
   * @throws NoApiKeyAvailableError if no key is configured anywhere for the provider
   * @throws UndecryptableApiKeyError if the user's stored key will not decrypt
   *   (never cached, so the next call re-reads the row)
   * @throws EncryptionMisconfiguredError if the service's encryption env is unusable
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

    // Try to get user's API key if userId provided. Never gated on the key being
    // present: a stored row with no usable key must throw, not read as "no key".
    if (userId !== undefined && userId.length > 0) {
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
    throw new NoApiKeyAvailableError(
      `No API key available for provider ${provider}. ` +
        'Please configure your own API key or contact the bot administrator.'
    );
  }

  /**
   * Resolve the system OpenRouter key, degrading to undefined on any failure
   * (no key configured, resolver error). Never throws — the quota-fallback
   * paths call this INSIDE error handling, where a fresh throw would replace
   * the original quota error they exist to propagate pristinely.
   */
  async resolveSystemOpenRouterKey(): Promise<string | undefined> {
    try {
      const result = await this.resolveApiKey(undefined, AIProvider.OpenRouter);
      return result.source === 'system' ? result.apiKey : undefined;
    } catch (error) {
      logger.warn({ err: error }, 'System OpenRouter key resolution failed');
      return undefined;
    }
  }

  /**
   * Resolve the user's OWN OpenRouter key (BYOK only — undefined when the
   * user has none, or on any resolver failure). A system-source result is
   * deliberately rejected: callers use this where landing on the system key
   * would be an owner-cost violation (e.g. a paid-default quota retarget).
   * Never throws, for the same reason as {@link resolveSystemOpenRouterKey}.
   */
  async resolveUserOpenRouterKey(userId: string): Promise<string | undefined> {
    try {
      const result = await this.resolveApiKey(userId, AIProvider.OpenRouter);
      return result.source === 'user' ? result.apiKey : undefined;
    } catch (error) {
      logger.warn({ err: error, userId }, 'User OpenRouter key resolution failed');
      return undefined;
    }
  }

  /**
   * Look up and decrypt a user's BYOK API key without falling back to the
   * system key. Returns `null` only if the user has no key for the requested
   * provider; the lookup always runs, whether or not an encryption key is set.
   *
   * Use this when callers want to know whether the user has a specific key
   * (e.g., ProviderRouter deciding whether to route z.ai-direct or fall through
   * to OpenRouter) — distinct from `resolveApiKey` which always returns
   * something or throws.
   *
   * A stored key that exists but will not decrypt THROWS (UndecryptableApiKeyError
   * / EncryptionMisconfiguredError) rather than returning null: null reads as
   * "no key" and would silently reroute the user.
   */
  async tryResolveUserKey(
    userId: string | undefined,
    provider: AIProvider
  ): Promise<string | null> {
    if (userId === undefined || userId.length === 0) {
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
   * Get and decrypt a user's API key from the database.
   *
   * Returns `null` when the user has no active key, or when the Prisma read
   * fails (logged; callers fall back to the system key as before). A row that
   * will not decrypt throws — see the error classes above.
   */
  private async getUserApiKey(userId: string, provider: AIProvider): Promise<string | null> {
    let userApiKey;
    try {
      userApiKey = await this.prisma.userApiKey.findFirst({
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
    } catch (error) {
      logger.error({ err: error, userId, provider }, 'Failed to retrieve user API key');
      return null;
    }

    if (userApiKey === null) {
      return null;
    }

    try {
      // Decrypt the key (uses encryption key from environment via getEncryptionKey())
      return decryptApiKey({
        iv: userApiKey.iv,
        content: userApiKey.content,
        tag: userApiKey.tag,
      });
    } catch (error) {
      // Decryption reads process.env, so the same env check decides the error class.
      if (!isEncryptionConfigured()) {
        logger.error({ err: error, userId, provider }, 'Encryption key missing or malformed');
        throw new EncryptionMisconfiguredError({ cause: error });
      }
      logger.warn({ err: error, userId, provider }, 'Stored user API key failed to decrypt');
      throw new UndecryptableApiKeyError(provider, { cause: error });
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
