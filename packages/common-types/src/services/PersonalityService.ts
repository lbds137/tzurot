/**
 * PersonalityService
 * Loads personalities from PostgreSQL with all their related configuration
 */

import { getPrismaClient } from './prisma.js';
import { createLogger } from '../utils/logger.js';
import { MODEL_DEFAULTS, AI_DEFAULTS, TIMEOUTS, PLACEHOLDERS } from '../constants/index.js';
import type { Decimal } from '@prisma/client/runtime/library';
import type { LoadedPersonality } from '../types/schemas.js';
import { z } from 'zod';

const logger = createLogger('PersonalityService');

/**
 * Helper to safely convert Prisma.Decimal or number to a number for Zod's validation
 */
function coerceToNumber(val: unknown): number | undefined {
  // Handle Prisma Decimal type
  if (val !== null && typeof val === 'object' && 'toNumber' in val && typeof val.toNumber === 'function') {
    return (val as Decimal).toNumber();
  }
  if (typeof val === 'number') {
    return val;
  }
  // Return undefined for null/undefined to let .optional() work correctly
  if (val === null || val === undefined) {
    return undefined;
  }
  return val as number; // Let Zod's number validation catch if it's not a number
}

/**
 * Zod schema for LLM configuration with automatic Prisma Decimal conversion
 *
 * Safety notes:
 * - All numeric fields use coerceToNumber to handle Prisma Decimal and null values
 * - Range validation prevents invalid values from reaching the AI providers
 * - .nullish() at top level handles both null and undefined for the entire config
 */
export const LlmConfigSchema = z.object({
  model: z.string().nullable().optional(), // Nullable for extra safety despite DB constraint
  visionModel: z.string().nullable().optional(),
  temperature: z.preprocess(coerceToNumber, z.number().min(0).max(2).optional()),
  maxTokens: z.preprocess(coerceToNumber, z.number().int().positive().max(1000000).optional()), // Max 1M tokens
  topP: z.preprocess(coerceToNumber, z.number().min(0).max(1).optional()),
  topK: z.preprocess(coerceToNumber, z.number().int().min(1).max(1000).optional()), // Common range: 1-1000
  frequencyPenalty: z.preprocess(coerceToNumber, z.number().min(-2).max(2).optional()),
  presencePenalty: z.preprocess(coerceToNumber, z.number().min(-2).max(2).optional()),
  memoryScoreThreshold: z.preprocess(coerceToNumber, z.number().min(0).max(1).optional()),
  memoryLimit: z.preprocess(coerceToNumber, z.number().int().positive().max(1000).optional()), // Max 1000 memories
  contextWindowTokens: z.preprocess(coerceToNumber, z.number().int().positive().max(2000000).optional()), // Max 2M tokens (future-proof)
}).nullish();

/**
 * Inferred TypeScript type from the Zod schema
 */
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

/**
 * Safely parses an unknown database object into a clean LlmConfig object
 * @param dbConfig - Unknown config object from database
 * @returns Validated and transformed LlmConfig or null
 */
function parseLlmConfig(dbConfig: unknown): LlmConfig {
  const result = LlmConfigSchema.safeParse(dbConfig);
  if (result.success) {
    return result.data;
  }
  // Log validation errors for debugging
  logger.warn({ error: result.error.format() }, 'Failed to parse LLM config, using defaults');
  return null;
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
    const publicUrl = process.env.PUBLIC_GATEWAY_URL ?? process.env.GATEWAY_URL;
    if (publicUrl === undefined || publicUrl.length === 0) {
      logger.warn(
        {},
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

      logger.info(
        {
          name: personality.name,
          model: personality.model,
          visionModel: personality.visionModel,
          hasVisionModel: personality.visionModel !== undefined && personality.visionModel !== null && personality.visionModel.length > 0,
          usedGlobalDefault: dbPersonality.defaultConfigLink === undefined && globalDefaultConfig !== null,
        },
        'Loaded personality with config'
      );
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
  private async loadGlobalDefaultConfig(): Promise<LlmConfig> {
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

      // Parse and validate the global default config
      const parsedConfig = parseLlmConfig(globalDefault);

      if (parsedConfig) {
        logger.info(
          {
            model: parsedConfig.model,
            visionModel: parsedConfig.visionModel,
            hasVisionModel: parsedConfig.visionModel !== undefined && parsedConfig.visionModel !== null && parsedConfig.visionModel.length > 0,
          },
          '[PersonalityService] Loaded global default LLM config'
        );
      } else {
        logger.warn({}, '[PersonalityService] No global default LLM config found');
      }

      return parsedConfig;
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
    if (text === null || text === undefined || text.length === 0) {return undefined;}

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
  private mapToPersonality(db: DatabasePersonality, globalDefaultConfig: LlmConfig = null): LoadedPersonality {
    // Parse personality-specific config from database (handles Decimal conversion)
    const personalityConfig = parseLlmConfig(db.defaultConfigLink?.llmConfig);

    // Merge configs with proper precedence: Personality > Global > Hardcoded Defaults
    const temperature = personalityConfig?.temperature ?? globalDefaultConfig?.temperature ?? AI_DEFAULTS.TEMPERATURE;
    const maxTokens = personalityConfig?.maxTokens ?? globalDefaultConfig?.maxTokens ?? AI_DEFAULTS.MAX_TOKENS;
    const topP = personalityConfig?.topP ?? globalDefaultConfig?.topP;
    const frequencyPenalty = personalityConfig?.frequencyPenalty ?? globalDefaultConfig?.frequencyPenalty;
    const presencePenalty = personalityConfig?.presencePenalty ?? globalDefaultConfig?.presencePenalty;
    const memoryScoreThreshold = personalityConfig?.memoryScoreThreshold ?? globalDefaultConfig?.memoryScoreThreshold;
    const memoryLimit = personalityConfig?.memoryLimit ?? globalDefaultConfig?.memoryLimit;

    // Replace placeholders in text fields
    // This normalizes legacy imports and ensures consistency
    const systemPrompt = this.replacePlaceholders(db.systemPrompt?.content, db.name) ?? '';
    const characterInfo = this.replacePlaceholders(db.characterInfo, db.name) ?? db.characterInfo;
    const personalityTraits = this.replacePlaceholders(db.personalityTraits, db.name) ?? db.personalityTraits;

    return {
      id: db.id,
      name: db.name,
      displayName: db.displayName ?? db.name,
      slug: db.slug,
      systemPrompt,
      model: personalityConfig?.model ?? globalDefaultConfig?.model ?? MODEL_DEFAULTS.DEFAULT_MODEL,
      visionModel: personalityConfig?.visionModel ?? globalDefaultConfig?.visionModel ?? undefined,
      temperature,
      maxTokens,
      topP,
      topK: personalityConfig?.topK ?? globalDefaultConfig?.topK ?? undefined,
      frequencyPenalty,
      presencePenalty,
      contextWindowTokens: personalityConfig?.contextWindowTokens ?? globalDefaultConfig?.contextWindowTokens ?? AI_DEFAULTS.CONTEXT_WINDOW_TOKENS,
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
    if (expiry === undefined || Date.now() > expiry) {
      this.personalityCache.delete(key);
      this.cacheExpiry.delete(key);
      this.cacheLastAccess.delete(key);
      return null;
    }

    // Update last access time for LRU tracking
    this.cacheLastAccess.set(key, Date.now());
    return this.personalityCache.get(key) ?? null;
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
    if (lruKey !== null && lruKey.length > 0) {
      this.personalityCache.delete(lruKey);
      this.cacheExpiry.delete(lruKey);
      this.cacheLastAccess.delete(lruKey);
      logger.debug(`[PersonalityService] Evicted LRU cache entry: ${lruKey}`);
    }
  }
}
