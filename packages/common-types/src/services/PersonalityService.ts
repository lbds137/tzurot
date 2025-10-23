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
      contextWindowSize: number;
    };
  } | null;
  memoryEnabled: boolean;
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
                  contextWindowSize: true,
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
                  contextWindowSize: true,
                },
              },
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
    // Extract llmConfig from defaultConfigLink
    const llmConfig = db.defaultConfigLink?.llmConfig;

    // Convert Decimal types to numbers, providing defaults where needed
    const temperature = llmConfig?.temperature
      ? parseFloat(llmConfig.temperature.toString())
      : 0.7; // Default temperature

    const maxTokens = llmConfig?.maxTokens ?? 4096; // Default max tokens

    const topP = llmConfig?.topP
      ? parseFloat(llmConfig.topP.toString())
      : undefined;

    const frequencyPenalty = llmConfig?.frequencyPenalty
      ? parseFloat(llmConfig.frequencyPenalty.toString())
      : undefined;

    const presencePenalty = llmConfig?.presencePenalty
      ? parseFloat(llmConfig.presencePenalty.toString())
      : undefined;

    const memoryScoreThreshold = llmConfig?.memoryScoreThreshold
      ? parseFloat(llmConfig.memoryScoreThreshold.toString())
      : undefined;

    const memoryLimit = llmConfig?.memoryLimit ?? undefined;

    return {
      id: db.id,
      name: db.name,
      displayName: db.displayName || db.name,
      systemPrompt: db.systemPrompt?.content || '',
      model: llmConfig?.model || 'gemini-2.5-pro',
      visionModel: llmConfig?.visionModel || undefined,
      temperature,
      maxTokens,
      topP,
      topK: llmConfig?.topK ?? undefined,
      frequencyPenalty,
      presencePenalty,
      contextWindow: llmConfig?.contextWindowSize ?? 20, // Now from llmConfig, not personality
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

}
