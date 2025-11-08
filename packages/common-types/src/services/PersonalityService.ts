/**
 * PersonalityService
 * Loads personalities from PostgreSQL with all their related configuration
 */

import { getPrismaClient } from './prisma.js';
import { createLogger } from '../utils/logger.js';
import { MODEL_DEFAULTS } from '../config/modelDefaults.js';
import { AI_DEFAULTS, TIMEOUTS, PLACEHOLDERS } from '../config/constants.js';
import type { Decimal } from '@prisma/client/runtime/library';

const logger = createLogger('PersonalityService');

/**
 * Simplified personality type for runtime use
 */
export interface LoadedPersonality {
  id: string;
  name: string;
  displayName: string;
  slug: string;
  systemPrompt: string;
  model: string;
  visionModel?: string; // Optional vision model for image processing
  temperature: number;
  maxTokens: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  contextWindowTokens: number;
  avatarUrl?: string;
  memoryScoreThreshold?: number;
  memoryLimit?: number;
  // Character definition fields
  characterInfo: string;
  personalityTraits: string;
  personalityTone?: string;
  personalityAge?: string;
  personalityAppearance?: string;
  personalityLikes?: string;
  personalityDislikes?: string;
  conversationalGoals?: string;
  conversationalExamples?: string;
}

export interface DatabasePersonality {
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  systemPrompt: {
    content: string;
  } | null;
  defaultConfigLink: {
    llmConfig: {
      model: string;
      visionModel: string | null;
      temperature: Decimal | null;
      topP: Decimal | null;
      topK: number | null;
      frequencyPenalty: Decimal | null;
      presencePenalty: Decimal | null;
      maxTokens: number | null;
      memoryScoreThreshold: Decimal | null;
      memoryLimit: number | null;
      contextWindowTokens: number;
    };
  } | null;
  // Character definition fields
  characterInfo: string;
  personalityTraits: string;
  personalityTone: string | null;
  personalityAge: string | null;
  personalityAppearance: string | null;
  personalityLikes: string | null;
  personalityDislikes: string | null;
  conversationalGoals: string | null;
  conversationalExamples: string | null;
}

export class PersonalityService {
  private prisma;
  private personalityCache: Map<string, LoadedPersonality>;
  private cacheExpiry: Map<string, number>;
  private cacheLastAccess: Map<string, number>;
  private readonly CACHE_TTL = TIMEOUTS.CACHE_TTL;
  private readonly MAX_CACHE_SIZE = 100; // Maximum personalities to cache

  constructor() {
    this.prisma = getPrismaClient();
    this.personalityCache = new Map();
    this.cacheExpiry = new Map();
    this.cacheLastAccess = new Map();
  }

  /**
   * Derive avatar URL from personality slug
   * Avatar files are named by slug: ${slug}.png
   * Uses PUBLIC_GATEWAY_URL if available (for external access like Discord avatars),
   * falls back to GATEWAY_URL for local development
   */
  static deriveAvatarUrl(slug: string): string | undefined {
    const publicUrl = process.env.PUBLIC_GATEWAY_URL || process.env.GATEWAY_URL;
    if (!publicUrl) {
      logger.warn(
        '[PersonalityService] No PUBLIC_GATEWAY_URL or GATEWAY_URL configured, cannot derive avatar URL'
      );
      return undefined;
    }

    return `${publicUrl}/avatars/${slug}.png`;
  }

  /**
   * Load a personality by name or ID
   */
  async loadPersonality(nameOrId: string): Promise<LoadedPersonality | null> {
    // Check cache first
    const cached = this.getFromCache(nameOrId);
    if (cached) {
      return cached;
    }

    try {
      // Check if nameOrId is a valid UUID (to avoid Prisma UUID parsing errors)
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        nameOrId
      );

      const dbPersonality = await this.prisma.personality.findFirst({
        where: {
          OR: [
            ...(isUUID ? [{ id: nameOrId }] : []),
            { name: { equals: nameOrId, mode: 'insensitive' } },
            { slug: nameOrId.toLowerCase() },
          ],
        },
        include: {
          systemPrompt: {
            select: { content: true },
          },
          defaultConfigLink: {
            select: {
              llmConfig: {
                select: {
                  model: true,
                  visionModel: true,
                  temperature: true,
                  topP: true,
                  topK: true,
                  frequencyPenalty: true,
                  presencePenalty: true,
                  maxTokens: true,
                  memoryScoreThreshold: true,
                  memoryLimit: true,
                  contextWindowTokens: true,
                },
              },
            },
          },
        },
      });

      if (!dbPersonality) {
        logger.debug(`Personality not found: ${nameOrId}`);
        return null;
      }

      // If personality has no default config, load global default as fallback
      let globalDefaultConfig = null;
      if (!dbPersonality.defaultConfigLink) {
        globalDefaultConfig = await this.loadGlobalDefaultConfig();
      }

      const personality = this.mapToPersonality(
        dbPersonality as DatabasePersonality,
        globalDefaultConfig
      );
      this.setCache(nameOrId, personality);

      logger.info(`Loaded personality: ${personality.name}`);
      return personality;
    } catch (error) {
      logger.error({ err: error }, `Failed to load personality: ${nameOrId}`);
      return null;
    }
  }

  /**
   * Load global default LLM config
   * Returns the config marked as isGlobal: true and isDefault: true
   */
  private async loadGlobalDefaultConfig() {
    try {
      const globalDefault = await this.prisma.llmConfig.findFirst({
        where: {
          isGlobal: true,
          isDefault: true,
        },
        select: {
          model: true,
          visionModel: true,
          temperature: true,
          topP: true,
          topK: true,
          frequencyPenalty: true,
          presencePenalty: true,
          maxTokens: true,
          memoryScoreThreshold: true,
          memoryLimit: true,
          contextWindowTokens: true,
        },
      });

      if (globalDefault) {
        logger.debug('[PersonalityService] Using global default LLM config as fallback');
      }

      return globalDefault;
    } catch (error) {
      logger.warn({ err: error }, '[PersonalityService] Failed to load global default config');
      return null;
    }
  }

  /**
   * Load all personalities
   */
  async loadAllPersonalities(): Promise<LoadedPersonality[]> {
    try {
      const dbPersonalities = await this.prisma.personality.findMany({
        include: {
          systemPrompt: {
            select: { content: true },
          },
          defaultConfigLink: {
            select: {
              llmConfig: {
                select: {
                  model: true,
                  visionModel: true,
                  temperature: true,
                  topP: true,
                  topK: true,
                  frequencyPenalty: true,
                  presencePenalty: true,
                  maxTokens: true,
                  memoryScoreThreshold: true,
                  memoryLimit: true,
                  contextWindowTokens: true,
                },
              },
            },
          },
        },
      });

      // Load global default config once for all personalities that need it
      const needsGlobalDefault = dbPersonalities.some((db: DatabasePersonality) => !db.defaultConfigLink);
      const globalDefaultConfig = needsGlobalDefault ? await this.loadGlobalDefaultConfig() : null;

      const personalities = dbPersonalities.map((db: DatabasePersonality) =>
        this.mapToPersonality(db, db.defaultConfigLink ? null : globalDefaultConfig)
      );

      // Cache all personalities
      for (const personality of personalities) {
        this.setCache(personality.name, personality);
      }

      logger.info(`Loaded ${personalities.length} personalities from database`);
      return personalities;
    } catch (error) {
      logger.error({ err: error }, 'Failed to load all personalities');
      return [];
    }
  }

  /**
   * Replace placeholders in text fields
   * Handles {user}, {{user}}, {assistant}, {shape}, {{char}}, {personality}
   */
  private replacePlaceholders(text: string | null | undefined, personalityName: string): string | undefined {
    if (!text) return undefined;

    let result = text;

    // Replace user placeholders with generic "{user}" token
    // (actual user name will be injected at prompt-building time)
    for (const placeholder of PLACEHOLDERS.USER) {
      if (placeholder !== '{user}') {
        const escapedPlaceholder = placeholder.replace(/[{}]/g, '\\$&');
        result = result.replace(new RegExp(escapedPlaceholder, 'g'), '{user}');
      }
    }

    // Replace assistant placeholders with personality name
    for (const placeholder of PLACEHOLDERS.ASSISTANT) {
      const escapedPlaceholder = placeholder.replace(/[{}]/g, '\\$&');
      result = result.replace(new RegExp(escapedPlaceholder, 'g'), personalityName);
    }

    return result;
  }

  /**
   * Map database personality to LoadedPersonality type
   *
   * Config cascade priority:
   * 1. Personality-specific default config (db.defaultConfigLink?.llmConfig)
   * 2. Global default config (globalDefaultConfig parameter)
   * 3. Hardcoded env variable fallbacks (MODEL_DEFAULTS.DEFAULT_MODEL, etc.)
   *
   * Placeholder handling:
   * - User placeholders ({user}, {{user}}) are normalized to {user}
   * - Assistant placeholders ({assistant}, {shape}, {{char}}, {personality}) are replaced with the personality name
   */
  private mapToPersonality(db: DatabasePersonality, globalDefaultConfig: any = null): LoadedPersonality {
    // Extract llmConfig from personality's defaultConfigLink
    const llmConfig = db.defaultConfigLink?.llmConfig;

    // Use global default as fallback if personality has no specific config
    const fallbackConfig = llmConfig || globalDefaultConfig;

    // Convert Decimal types to numbers, providing defaults where needed
    const temperature = fallbackConfig?.temperature
      ? parseFloat(fallbackConfig.temperature.toString())
      : AI_DEFAULTS.TEMPERATURE;

    const maxTokens = fallbackConfig?.maxTokens ?? AI_DEFAULTS.MAX_TOKENS;

    const topP = fallbackConfig?.topP ? parseFloat(fallbackConfig.topP.toString()) : undefined;

    const frequencyPenalty = fallbackConfig?.frequencyPenalty
      ? parseFloat(fallbackConfig.frequencyPenalty.toString())
      : undefined;

    const presencePenalty = fallbackConfig?.presencePenalty
      ? parseFloat(fallbackConfig.presencePenalty.toString())
      : undefined;

    const memoryScoreThreshold = fallbackConfig?.memoryScoreThreshold
      ? parseFloat(fallbackConfig.memoryScoreThreshold.toString())
      : undefined;

    const memoryLimit = fallbackConfig?.memoryLimit ?? undefined;

    // Replace placeholders in text fields
    // This normalizes legacy imports and ensures consistency
    const systemPrompt = this.replacePlaceholders(db.systemPrompt?.content, db.name) || '';
    const characterInfo = this.replacePlaceholders(db.characterInfo, db.name) || db.characterInfo;
    const personalityTraits = this.replacePlaceholders(db.personalityTraits, db.name) || db.personalityTraits;

    return {
      id: db.id,
      name: db.name,
      displayName: db.displayName || db.name,
      slug: db.slug,
      systemPrompt,
      model: fallbackConfig?.model || MODEL_DEFAULTS.DEFAULT_MODEL, // Cascade: personality -> global -> env
      visionModel: fallbackConfig?.visionModel || undefined,
      temperature,
      maxTokens,
      topP,
      topK: fallbackConfig?.topK ?? undefined,
      frequencyPenalty,
      presencePenalty,
      contextWindowTokens: fallbackConfig?.contextWindowTokens ?? AI_DEFAULTS.CONTEXT_WINDOW_TOKENS,
      avatarUrl: PersonalityService.deriveAvatarUrl(db.slug),
      memoryScoreThreshold,
      memoryLimit,
      // Character definition fields (with placeholders replaced)
      characterInfo,
      personalityTraits,
      personalityTone: this.replacePlaceholders(db.personalityTone, db.name),
      personalityAge: this.replacePlaceholders(db.personalityAge, db.name),
      personalityAppearance: this.replacePlaceholders(db.personalityAppearance, db.name),
      personalityLikes: this.replacePlaceholders(db.personalityLikes, db.name),
      personalityDislikes: this.replacePlaceholders(db.personalityDislikes, db.name),
      conversationalGoals: this.replacePlaceholders(db.conversationalGoals, db.name),
      conversationalExamples: this.replacePlaceholders(db.conversationalExamples, db.name),
    };
  }

  /**
   * Get from cache if not expired
   */
  private getFromCache(key: string): LoadedPersonality | null {
    const expiry = this.cacheExpiry.get(key);
    if (!expiry || Date.now() > expiry) {
      this.personalityCache.delete(key);
      this.cacheExpiry.delete(key);
      this.cacheLastAccess.delete(key);
      return null;
    }

    // Update last access time for LRU tracking
    this.cacheLastAccess.set(key, Date.now());
    return this.personalityCache.get(key) || null;
  }

  /**
   * Set cache with expiry and LRU eviction
   */
  private setCache(key: string, personality: LoadedPersonality): void {
    // Evict least recently used entries if cache is full
    if (this.personalityCache.size >= this.MAX_CACHE_SIZE && !this.personalityCache.has(key)) {
      this.evictLRU();
    }

    this.personalityCache.set(key, personality);
    this.cacheExpiry.set(key, Date.now() + this.CACHE_TTL);
    this.cacheLastAccess.set(key, Date.now());
  }

  /**
   * Evict least recently used cache entries
   */
  private evictLRU(): void {
    if (this.cacheLastAccess.size === 0) {
      return;
    }

    // Find the least recently used entry
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, lastAccess] of this.cacheLastAccess.entries()) {
      if (lastAccess < lruTime) {
        lruTime = lastAccess;
        lruKey = key;
      }
    }

    // Remove the LRU entry
    if (lruKey) {
      this.personalityCache.delete(lruKey);
      this.cacheExpiry.delete(lruKey);
      this.cacheLastAccess.delete(lruKey);
      logger.debug(`[PersonalityService] Evicted LRU cache entry: ${lruKey}`);
    }
  }
}
