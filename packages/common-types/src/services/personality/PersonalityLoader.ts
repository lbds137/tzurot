/**
 * PersonalityLoader
 * Database query logic for loading personalities from PostgreSQL
 */

import type { PrismaClient } from '../prisma.js';
import { createLogger } from '../../utils/logger.js';
import { isBotOwner } from '../../utils/ownerMiddleware.js';
import { isValidUUID, SYNC_LIMITS } from '../../constants/index.js';
import type { DatabasePersonality } from './PersonalityValidator.js';
import { LLM_CONFIG_SELECT, mapLlmConfigFromDb, type MappedLlmConfig } from '../LlmConfigMapper.js';

const logger = createLogger('PersonalityLoader');

/**
 * Prisma query select object for personality queries
 * Extracted as constant to ensure consistency across loadPersonality and loadAllPersonalities
 *
 * Uses LLM_CONFIG_SELECT from LlmConfigMapper for LLM config fields,
 * ensuring we read from advancedParameters JSONB instead of legacy columns.
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
        select: LLM_CONFIG_SELECT, // Uses advancedParameters JSONB
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
   * - No ownerUuid provided (internal operations or bot owner bypass)
   * - Personality is public OR user is owner
   *
   * @param ownerUuid - User's database UUID for ownership check (optional)
   * @returns Prisma where clause for access control, or undefined if no filtering needed
   */
  private buildAccessFilter(
    ownerUuid?: string
  ): { OR: ({ isPublic: boolean } | { ownerId: string })[] } | { isPublic: true } | undefined {
    if (ownerUuid === undefined || ownerUuid === '') {
      // No access control - internal operations or bot owner bypass
      return undefined;
    }

    // User not in database - can only access public personalities
    if (ownerUuid === PersonalityLoader.PUBLIC_ONLY_SENTINEL) {
      return { isPublic: true };
    }

    // User must have access: personality is public OR user is owner
    return {
      OR: [{ isPublic: true }, { ownerId: ownerUuid }],
    };
  }

  /**
   * Sentinel value indicating user should only see public personalities.
   * Used when user doesn't exist in database yet.
   */
  private static readonly PUBLIC_ONLY_SENTINEL = '__PUBLIC_ONLY__';

  /**
   * Resolve Discord user ID to database UUID for ownership checks
   *
   * @param discordUserId - Discord user ID
   * @returns User's database UUID, sentinel for public-only, or undefined for no filtering
   */
  private async resolveOwnerUuid(discordUserId?: string): Promise<string | undefined> {
    if (discordUserId === undefined || discordUserId === '') {
      return undefined;
    }

    // Bot owner bypass - admin can access all personalities
    if (isBotOwner(discordUserId)) {
      logger.debug(
        { discordUserId },
        '[PersonalityLoader] Bot owner bypass - no access filter applied'
      );
      return undefined;
    }

    // Look up user by Discord ID to get their database UUID
    const user = await this.prisma.user.findUnique({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (user === null) {
      logger.debug(
        { discordUserId },
        '[PersonalityLoader] User not found in database - public personalities only'
      );
      // Return sentinel that buildAccessFilter recognizes as "public only"
      // This ensures the user can only access public personalities without causing
      // a Prisma error (ownerId is a UUID column, can't compare to arbitrary string)
      return PersonalityLoader.PUBLIC_ONLY_SENTINEL;
    }

    return user.id;
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
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Multi-strategy lookup: UUID → name → slug → alias with access control filtering
  async loadFromDatabase(nameOrId: string, userId?: string): Promise<DatabasePersonality | null> {
    // Resolve Discord user ID to database UUID for ownership checks
    const ownerUuid = await this.resolveOwnerUuid(userId);

    // Build access control filter using the resolved UUID
    const accessFilter = this.buildAccessFilter(ownerUuid);
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
      // Bounded query with safety cap for search results
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
        take: SYNC_LIMITS.MAX_PERSONALITY_SEARCH,
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
   *
   * @returns MappedLlmConfig with ALL params from advancedParameters JSONB, or null if not found
   */
  async loadGlobalDefaultConfig(): Promise<MappedLlmConfig | null> {
    try {
      const globalDefault = await this.prisma.llmConfig.findFirst({
        where: {
          isGlobal: true,
          isDefault: true,
        },
        select: LLM_CONFIG_SELECT, // Uses advancedParameters JSONB
      });

      if (globalDefault === null) {
        logger.warn({}, '[PersonalityLoader] No global default LLM config found');
        return null;
      }

      // Map the raw DB result to application format using the shared mapper
      const mappedConfig = mapLlmConfigFromDb(globalDefault);

      logger.info(
        {
          model: mappedConfig.model,
          visionModel: mappedConfig.visionModel,
          hasVisionModel:
            mappedConfig.visionModel !== undefined &&
            mappedConfig.visionModel !== null &&
            mappedConfig.visionModel.length > 0,
        },
        '[PersonalityLoader] Loaded global default LLM config'
      );

      return mappedConfig;
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
      // Bounded query with reasonable cap for personality catalog
      const dbPersonalities = await this.prisma.personality.findMany({
        select: PERSONALITY_SELECT,
        take: SYNC_LIMITS.MAX_PERSONALITY_CATALOG,
      });

      logger.info(`Loaded ${dbPersonalities.length} personalities from database`);
      return dbPersonalities as DatabasePersonality[];
    } catch (error) {
      logger.error({ err: error }, 'Failed to load all personalities from database');
      return [];
    }
  }
}
