/**
 * PersonalityLoader
 * Database query logic for loading personalities from PostgreSQL
 */

import type { PrismaClient } from '../prisma.js';
import { createLogger } from '../../utils/logger.js';
import { isBotOwner } from '../../utils/ownerMiddleware.js';
import { isValidUUID } from '../../constants/service.js';
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
  updatedAt: true, // For avatar cache-busting
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
   * Access is granted if:
   * - No userId provided (internal operations)
   * - User is bot owner (admin bypass)
   * - Personality is public OR user is owner
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

    // Bot owner bypass - admin can access all personalities
    if (isBotOwner(userId)) {
      logger.debug({ userId }, '[PersonalityLoader] Bot owner bypass - no access filter applied');
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
   * - Owned by the requesting user (ownerId = userId), OR
   * - Requested by the bot owner (admin bypass)
   *
   * @param nameOrId - Personality name, UUID, slug, or alias
   * @param userId - Discord user ID for access control (optional - omit for internal operations)
   * @returns DatabasePersonality or null if not found or access denied
   */
  async loadFromDatabase(nameOrId: string, userId?: string): Promise<DatabasePersonality | null> {
    // Build access control filter
    const accessFilter = this.buildAccessFilter(userId);
    const searchLower = nameOrId.toLowerCase();

    try {
      // Prioritized lookup order: UUID → Name → Slug → Alias
      // This prevents slug collisions from overriding name matches
      // (e.g., personality with name "Lilith" should win over one with slug "lilith")

      // Step 1a: Try UUID lookup (if input looks like UUID)
      if (isValidUUID(nameOrId)) {
        const byId = await this.prisma.personality.findFirst({
          where: {
            AND: [{ id: nameOrId }, ...(accessFilter ? [accessFilter] : [])],
          },
          select: PERSONALITY_SELECT,
        });
        if (byId) {
          return byId as DatabasePersonality;
        }
      }

      // Step 1b+1c: Fetch name OR slug candidates in single query, prioritize in-memory
      // This optimizes from 2 sequential queries to 1 query with in-memory prioritization
      const candidates = await this.prisma.personality.findMany({
        where: {
          AND: [
            {
              OR: [
                { name: { equals: nameOrId, mode: 'insensitive' as const } },
                { slug: searchLower },
              ],
            },
            ...(accessFilter ? [accessFilter] : []),
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: PERSONALITY_SELECT,
      });

      // Prioritize in-memory: Name match takes priority over slug match
      // This prevents slug "lilith" from overriding a personality actually named "Lilith"
      const nameMatch = candidates.find(c => c.name.toLowerCase() === searchLower);
      if (nameMatch) {
        return nameMatch as DatabasePersonality;
      }

      const slugMatch = candidates.find(c => c.slug === searchLower);
      if (slugMatch) {
        return slugMatch as DatabasePersonality;
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
   * Load all personalities from database (internal operations only)
   *
   * WARNING: This method has no access control - it returns ALL personalities
   * including private ones. Only use for internal operations like:
   * - Startup verification (counting personalities)
   * - Admin operations
   * - Cache warming
   *
   * For user-facing operations that need to list personalities,
   * use the API gateway endpoints which enforce access control.
   *
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
