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

import {
  createLogger,
  getConfig,
  decryptApiKey,
  AIProvider,
  INTERVALS,
  type PrismaClient,
} from '@tzurot/common-types';

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
interface CacheEntry {
  result: ApiKeyResolutionResult;
  expiresAt: number;
}

/**
 * API Key Resolver - handles BYOK key lookup and decryption
 */
export class ApiKeyResolver {
  private prisma: PrismaClient;
  private encryptionKey: string;
  private cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;

  constructor(prisma: PrismaClient, encryptionKey?: string, options?: { cacheTtlMs?: number }) {
    this.prisma = prisma;
    this.encryptionKey = encryptionKey ?? config.API_KEY_ENCRYPTION_KEY ?? '';
    this.cacheTtlMs = options?.cacheTtlMs ?? INTERVALS.API_KEY_CACHE_TTL;

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
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug({ userId, provider, source: 'cache' }, 'API key resolved from cache');
      return cached.result;
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
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * Invalidate cache for a user (call when they update their API keys)
   */
  invalidateUserCache(userId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}-`)) {
        this.cache.delete(key);
      }
    }
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
