/**
 * PersonalityLoader
 * Database query logic for loading personalities from PostgreSQL
 */

import type { PrismaClient } from '../prisma.js';
import { createLogger } from '../../utils/logger.js';
import type { DatabasePersonality, LlmConfig } from './PersonalityValidator.js';
import { parseLlmConfig } from './PersonalityValidator.js';

const logger = createLogger('PersonalityLoader');

/**
 * Prisma query select object for personality queries
 * Extracted as constant to ensure consistency across loadPersonality and loadAllPersonalities
 */
const PERSONALITY_INCLUDE = {
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
};

export class PersonalityLoader {
  constructor(private prisma: PrismaClient) {}

  /**
   * Load a personality by name, ID, slug, or alias from database
   *
   * Lookup order:
   * 1. UUID (if input looks like a UUID)
   * 2. Name (case-insensitive)
   * 3. Slug (lowercase)
   * 4. Alias (case-insensitive) - falls back to PersonalityAlias table
   *
   * @param nameOrId - Personality name, UUID, slug, or alias
   * @returns DatabasePersonality or null if not found
   */
  async loadFromDatabase(nameOrId: string): Promise<DatabasePersonality | null> {
    // Check if nameOrId is a valid UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);

    try {
      // Step 1: Try direct lookup by ID, name, or slug
      const dbPersonality = await this.prisma.personality.findFirst({
        where: {
          OR: [
            ...(isUUID ? [{ id: nameOrId }] : []),
            { name: { equals: nameOrId, mode: 'insensitive' } },
            { slug: nameOrId.toLowerCase() },
          ],
        },
        include: PERSONALITY_INCLUDE,
      });

      if (dbPersonality) {
        return dbPersonality as DatabasePersonality;
      }

      // Step 2: If not found, check aliases (case-insensitive)
      const aliasMatch = await this.prisma.personalityAlias.findFirst({
        where: {
          alias: { equals: nameOrId.toLowerCase(), mode: 'insensitive' },
        },
        select: { personalityId: true },
      });

      if (aliasMatch) {
        logger.debug(
          { alias: nameOrId, personalityId: aliasMatch.personalityId },
          '[PersonalityLoader] Found personality via alias'
        );

        // Load the personality by its ID
        const personalityByAlias = await this.prisma.personality.findUnique({
          where: { id: aliasMatch.personalityId },
          include: PERSONALITY_INCLUDE,
        });

        if (personalityByAlias) {
          return personalityByAlias as DatabasePersonality;
        }
      }

      logger.debug(`Personality not found: ${nameOrId}`);
      return null;
    } catch (error) {
      logger.error({ err: error }, `Failed to load personality from database: ${nameOrId}`);
      return null;
    }
  }

  /**
   * Load global default LLM config
   * Returns the config marked as isGlobal: true and isDefault: true
   */
  async loadGlobalDefaultConfig(): Promise<LlmConfig> {
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
            hasVisionModel:
              parsedConfig.visionModel !== undefined &&
              parsedConfig.visionModel !== null &&
              parsedConfig.visionModel.length > 0,
          },
          '[PersonalityLoader] Loaded global default LLM config'
        );
      } else {
        logger.warn({}, '[PersonalityLoader] No global default LLM config found');
      }

      return parsedConfig;
    } catch (error) {
      logger.warn({ err: error }, '[PersonalityLoader] Failed to load global default config');
      return null;
    }
  }

  /**
   * Load all personalities from database
   * @returns Array of DatabasePersonality objects
   */
  async loadAllFromDatabase(): Promise<DatabasePersonality[]> {
    try {
      const dbPersonalities = await this.prisma.personality.findMany({
        include: PERSONALITY_INCLUDE,
      });

      logger.info(`Loaded ${dbPersonalities.length} personalities from database`);
      return dbPersonalities as DatabasePersonality[];
    } catch (error) {
      logger.error({ err: error }, 'Failed to load all personalities from database');
      return [];
    }
  }
}
