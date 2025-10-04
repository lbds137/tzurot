/**
 * PersonalityService
 * Loads personalities from PostgreSQL with all their related configuration
 */

import { getPrismaClient } from './prisma.js';
import { createLogger } from '../logger.js';
import type { Decimal } from '@prisma/client/runtime/library';

const logger = createLogger('PersonalityService');

/**
 * Simplified personality type for runtime use
 */
export interface LoadedPersonality {
  id: string;
  name: string;
  displayName: string;
  systemPrompt: string;
  model: string;
  visionModel?: string; // Optional vision model for image processing
  temperature: number;
  maxTokens: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  contextWindow: number;
  avatarUrl?: string;
  memoryEnabled: boolean;
  memoryScoreThreshold?: number;
  memoryLimit?: number;
  // Character definition fields
  characterInfo: string;
  personalityTraits: string;
  personalityTone?: string;
  personalityAge?: string;
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
  avatarUrl: string | null;
  systemPrompt: {
    content: string;
  } | null;
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
  } | null;
  memoryEnabled: boolean;
  contextWindowSize: number;
  // Character definition fields
  characterInfo: string;
  personalityTraits: string;
  personalityTone: string | null;
  personalityAge: string | null;
  personalityLikes: string | null;
  personalityDislikes: string | null;
  conversationalGoals: string | null;
  conversationalExamples: string | null;
}

export class PersonalityService {
  private prisma;
  private personalityCache: Map<string, LoadedPersonality>;
  private cacheExpiry: Map<string, number>;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.prisma = getPrismaClient();
    this.personalityCache = new Map();
    this.cacheExpiry = new Map();
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
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);

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
            },
          },
        },
      });

      if (!dbPersonality) {
        logger.debug(`Personality not found: ${nameOrId}`);
        return null;
      }

      const personality = this.mapToPersonality(dbPersonality as DatabasePersonality);
      this.setCache(nameOrId, personality);

      logger.info(`Loaded personality: ${personality.name}`);
      return personality;

    } catch (error) {
      logger.error({ err: error }, `Failed to load personality: ${nameOrId}`);
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
            },
          },
        },
      });

      const personalities = dbPersonalities.map((db: DatabasePersonality) =>
        this.mapToPersonality(db)
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
   * Map database personality to LoadedPersonality type
   */
  private mapToPersonality(db: DatabasePersonality): LoadedPersonality {
    // Convert Decimal types to numbers, providing defaults where needed
    const temperature = db.llmConfig?.temperature
      ? parseFloat(db.llmConfig.temperature.toString())
      : 0.7; // Default temperature

    const maxTokens = db.llmConfig?.maxTokens ?? 4096; // Default max tokens

    const topP = db.llmConfig?.topP
      ? parseFloat(db.llmConfig.topP.toString())
      : undefined;

    const frequencyPenalty = db.llmConfig?.frequencyPenalty
      ? parseFloat(db.llmConfig.frequencyPenalty.toString())
      : undefined;

    const presencePenalty = db.llmConfig?.presencePenalty
      ? parseFloat(db.llmConfig.presencePenalty.toString())
      : undefined;

    const memoryScoreThreshold = db.llmConfig?.memoryScoreThreshold
      ? parseFloat(db.llmConfig.memoryScoreThreshold.toString())
      : undefined;

    const memoryLimit = db.llmConfig?.memoryLimit ?? undefined;

    return {
      id: db.id,
      name: db.name,
      displayName: db.displayName || db.name,
      systemPrompt: db.systemPrompt?.content || '',
      model: db.llmConfig?.model || 'gemini-2.5-pro',
      visionModel: db.llmConfig?.visionModel || undefined,
      temperature,
      maxTokens,
      topP,
      topK: db.llmConfig?.topK ?? undefined,
      frequencyPenalty,
      presencePenalty,
      contextWindow: db.contextWindowSize,
      avatarUrl: db.avatarUrl || undefined,
      memoryEnabled: db.memoryEnabled,
      memoryScoreThreshold,
      memoryLimit,
      // Character definition fields
      characterInfo: db.characterInfo,
      personalityTraits: db.personalityTraits,
      personalityTone: db.personalityTone || undefined,
      personalityAge: db.personalityAge || undefined,
      personalityLikes: db.personalityLikes || undefined,
      personalityDislikes: db.personalityDislikes || undefined,
      conversationalGoals: db.conversationalGoals || undefined,
      conversationalExamples: db.conversationalExamples || undefined,
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
      return null;
    }

    return this.personalityCache.get(key) || null;
  }

  /**
   * Set cache with expiry
   */
  private setCache(key: string, personality: LoadedPersonality): void {
    this.personalityCache.set(key, personality);
    this.cacheExpiry.set(key, Date.now() + this.CACHE_TTL);
  }

  /**
   * Clear cache (useful after personality updates)
   */
  clearCache(): void {
    this.personalityCache.clear();
    this.cacheExpiry.clear();
    logger.debug('Personality cache cleared');
  }
}
