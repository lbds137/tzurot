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
const PERSONALITY_SELECT = {
  id: true,
  name: true,
  displayName: true,
  slug: true,
  isPublic: true,
  ownerId: true,
  characterInfo: true,
  personalityTraits: true,
  personalityTone: true,
  personalityAge: true,
  personalityAppearance: true,
  personalityLikes: true,
  personalityDislikes: true,
  conversationalGoals: true,
  conversationalExamples: true,
  errorMessage: true,
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
   * Build access control filter for personality queries
   *
   * @param userId - Discord user ID requesting access (optional)
   * @returns Prisma where clause for access control, or undefined if no filtering needed
   */
  private buildAccessFilter(
    userId?: string
  ): { OR: ({ isPublic: boolean } | { ownerId: string })[] } | undefined {
    if (userId === undefined || userId === '') {
      // No access control - internal operations
      return undefined;
    }

    // User must have access: personality is public OR user is owner
    return {
      OR: [{ isPublic: true }, { ownerId: userId }],
    };
  }

  /**
   * Load a personality by name, ID, slug, or alias from database
   *
   * Lookup order:
   * 1. UUID (if input looks like a UUID)
   * 2. Name (case-insensitive)
   * 3. Slug (lowercase)
   * 4. Alias (case-insensitive) - falls back to PersonalityAlias table
   *
   * Access Control:
   * When userId is provided, only returns personalities that are:
   * - Public (isPublic = true), OR
   * - Owned by the requesting user (ownerId = userId)
   *
   * @param nameOrId - Personality name, UUID, slug, or alias
   * @param userId - Discord user ID for access control (optional - omit for internal operations)
   * @returns DatabasePersonality or null if not found or access denied
   */
  async loadFromDatabase(nameOrId: string, userId?: string): Promise<DatabasePersonality | null> {
    // Check if nameOrId is a valid UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);

    // Build access control filter
    const accessFilter = this.buildAccessFilter(userId);

    try {
      // Step 1: Try direct lookup by ID, name, or slug
      const dbPersonality = await this.prisma.personality.findFirst({
        where: {
          AND: [
            {
              OR: [
                ...(isUUID ? [{ id: nameOrId }] : []),
                { name: { equals: nameOrId, mode: 'insensitive' } },
                { slug: nameOrId.toLowerCase() },
              ],
            },
            // Apply access filter if userId provided
            ...(accessFilter ? [accessFilter] : []),
          ],
        },
        select: PERSONALITY_SELECT,
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

        // Load the personality by its ID (with access control)
        const personalityByAlias = await this.prisma.personality.findFirst({
          where: {
            AND: [
              { id: aliasMatch.personalityId },
              // Apply access filter if userId provided
              ...(accessFilter ? [accessFilter] : []),
            ],
          },
          select: PERSONALITY_SELECT,
        });

        if (personalityByAlias) {
          return personalityByAlias as DatabasePersonality;
        }

        // Personality exists but user doesn't have access
        if (userId !== undefined && userId !== '') {
          logger.debug(
            { alias: nameOrId, personalityId: aliasMatch.personalityId, userId },
            '[PersonalityLoader] Personality exists but user lacks access'
          );
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
        select: PERSONALITY_SELECT,
      });

      logger.info(`Loaded ${dbPersonalities.length} personalities from database`);
      return dbPersonalities as DatabasePersonality[];
    } catch (error) {
      logger.error({ err: error }, 'Failed to load all personalities from database');
      return [];
    }
  }
}
