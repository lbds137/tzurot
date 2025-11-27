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
  type PrismaClient,
} from '@tzurot/common-types';

const logger = createLogger('ApiKeyResolver');
const config = getConfig();

/**
 * Result of API key resolution
 */
export interface ApiKeyResolutionResult {
  /** The resolved API key (decrypted) */
  apiKey: string;
  /** Source of the key */
  source: 'user' | 'system';
  /** Provider the key is for */
  provider: AIProvider;
  /** User ID if resolved from user's wallet */
  userId?: string;
}

/**
 * Cache entry for API keys (to avoid repeated DB lookups)
 *
 * Note: Cache is local to each ai-worker instance. When users update/remove
 * their API keys via the API gateway, the cache won't be immediately invalidated.
 * Keys will refresh after the TTL expires (default 60 seconds).
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
    this.cacheTtlMs = options?.cacheTtlMs ?? 5 * 1000; // 5 seconds - short TTL to ensure key updates propagate quickly

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
        };
        this.cacheResult(cacheKey, result);
        logger.debug({ userId, provider, source: 'user' }, 'API key resolved from user wallet');
        return result;
      }
    }

    // Fall back to system API key
    const systemKey = this.getSystemApiKey(provider);
    if (systemKey === null) {
      throw new Error(
        `No API key available for provider ${provider}. ` +
          'User has no BYOK key and system key is not configured.'
      );
    }

    const result: ApiKeyResolutionResult = {
      apiKey: systemKey,
      source: 'system',
      provider,
    };
    this.cacheResult(cacheKey, result);
    logger.debug({ userId, provider, source: 'system' }, 'API key resolved from system');
    return result;
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
      const decrypted = decryptApiKey({
        iv: userApiKey.iv,
        content: userApiKey.content,
        tag: userApiKey.tag,
      });

      return decrypted;
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
      case AIProvider.OpenAI:
        return config.OPENAI_API_KEY ?? null;
      default:
        return null;
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
