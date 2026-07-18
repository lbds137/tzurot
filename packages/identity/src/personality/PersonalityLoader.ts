/**
 * PersonalityLoader
 * Database query logic for loading personalities from PostgreSQL
 */

import { getConfig } from '@tzurot/common-types/config/config';
import { isValidUUID } from '@tzurot/common-types/constants/service';
import { SYNC_LIMITS } from '@tzurot/common-types/constants/timing';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  LLM_CONFIG_SELECT,
  mapLlmConfigFromDb,
  type MappedLlmConfig,
} from '@tzurot/common-types/services/LlmConfigMapper';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import type { DatabasePersonality } from './PersonalityValidator.js';

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
  createdAt: true,
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
  voiceEnabled: true,
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
  /**
   * Bot admin's database UUID.
   * - undefined: not yet resolved
   * - null (cached): BOT_OWNER_ID not configured — permanent for instance lifetime
   * - string (cached): resolved admin UUID — permanent for instance lifetime
   * Note: when admin exists in config but not in DB, null is returned but NOT cached (retry on next collision)
   */
  private botAdminUuid: string | null | undefined;

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
   * Resolve the requesting user's database uuid for PERSONAL-alias lookup.
   * Deliberately separate from resolveOwnerUuid: that method conflates
   * "who filters access" (bot owner → no filter → undefined) with "who is
   * asking" — but the bot owner's own personal aliases must still resolve.
   */
  private async resolveAliasUserUuid(discordUserId?: string): Promise<string | undefined> {
    if (discordUserId === undefined || discordUserId === '') {
      return undefined;
    }
    const user = await this.prisma.user.findUnique({
      where: { discordId: discordUserId },
      select: { id: true },
    });
    return user?.id;
  }

  /**
   * Look up one alias tier (personal or global) and load its personality
   * with the access filter applied. Returns null when the alias doesn't
   * exist in that tier OR the personality is inaccessible — callers fall
   * through to the next tier either way.
   */
  private async findPersonalityViaAlias(
    aliasLower: string,
    scope: { userId: string } | 'global',
    accessFilter: ReturnType<PersonalityLoader['buildAccessFilter']>,
    originalInput: string
  ): Promise<DatabasePersonality | null> {
    const aliasMatch = await this.prisma.personalityAlias.findFirst({
      where: {
        alias: { equals: aliasLower, mode: 'insensitive' },
        userId: scope === 'global' ? null : scope.userId,
      },
      select: { personalityId: true },
    });
    if (!aliasMatch) {
      return null;
    }

    const tier = scope === 'global' ? 'global' : 'personal';
    const personality = await this.prisma.personality.findFirst({
      where: {
        AND: [{ id: aliasMatch.personalityId }, ...(accessFilter ? [accessFilter] : [])],
      },
      select: PERSONALITY_SELECT,
    });

    if (personality) {
      logger.debug(
        { alias: originalInput, personalityId: aliasMatch.personalityId, tier },
        '[PersonalityLoader] Found personality via alias'
      );
      return personality;
    }

    logger.debug(
      { alias: originalInput, personalityId: aliasMatch.personalityId, tier },
      '[PersonalityLoader] Alias matched but personality inaccessible — falling through'
    );
    return null;
  }

  /**
   * Load a personality by name, ID, slug, or alias from database
   *
   * Lookup order:
   * 1. UUID (if input looks like a UUID)
   * 2. Name (case-insensitive)
   * 3. Slug (lowercase)
   * 4. PERSONAL alias (the requesting user's own rows — beats global)
   * 5. GLOBAL alias (userId IS NULL rows)
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
          return byId;
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
      const nameMatches = candidates.filter(c => c.name.toLowerCase() === searchLower);

      if (nameMatches.length === 1) {
        return nameMatches[0];
      }

      if (nameMatches.length > 1) {
        // Multiple personalities share the same name — pick by priority:
        // public > private, admin-owned > others, tiebreaker: oldest (from DB ordering)
        return await this.pickBestCandidate(nameMatches);
      }

      const slugMatch = candidates.find(c => c.slug === searchLower);
      if (slugMatch) {
        return slugMatch;
      }

      // Step 2: aliases — the requesting user's PERSONAL aliases first, then
      // GLOBAL rows. Two sequential lookups by design (not one OR query): a
      // personal alias pointing at a personality this user can no longer
      // access must fall through to a same-named global alias, and each step
      // re-applies the access filter on the personality load.

      // Step 2a: personal tier. Needs the user's uuid even when the access
      // filter is bypassed (bot owner), so it resolves independently of
      // resolveOwnerUuid's filter concern. Skipped for internal calls and
      // users with no row (they can't have personal aliases).
      const aliasUserUuid = await this.resolveAliasUserUuid(userId);
      if (aliasUserUuid !== undefined) {
        const viaPersonal = await this.findPersonalityViaAlias(
          searchLower,
          { userId: aliasUserUuid },
          accessFilter,
          nameOrId
        );
        if (viaPersonal) {
          return viaPersonal;
        }
      }

      // Step 2b: global tier (userId IS NULL rows).
      const viaGlobal = await this.findPersonalityViaAlias(
        searchLower,
        'global',
        accessFilter,
        nameOrId
      );
      if (viaGlobal) {
        return viaGlobal;
      }

      logger.debug({ nameOrId }, 'Personality not found');
      return null;
    } catch (error) {
      logger.error({ err: error, nameOrId }, 'Failed to load personality from database');
      return null;
    }
  }

  /**
   * Pick the best candidate when multiple personalities share the same name.
   *
   * | Public? | Admin-owned? | Score | Example                              |
   * |---------|-------------|-------|--------------------------------------|
   * | Yes     | Yes         | 3     | Admin's public character — always wins |
   * | Yes     | No          | 2     | Another user's public character       |
   * | No      | Yes         | 1     | Admin's private character              |
   * | No      | No          | 0     | Another user's private character       |
   *
   * Tiebreaker within same score: oldest (createdAt ascending).
   */
  private async pickBestCandidate(matches: DatabasePersonality[]): Promise<DatabasePersonality> {
    const adminUuid = await this.resolveBotAdminUuid();

    const score = (c: { isPublic: boolean; ownerId: string }): number =>
      (c.isPublic ? 2 : 0) + (c.ownerId === adminUuid ? 1 : 0);

    return matches.reduce((best, current) => {
      const diff = score(current) - score(best);
      if (diff > 0) {
        return current;
      }
      if (diff < 0) {
        return best;
      }
      // Same score — oldest wins
      return current.createdAt < best.createdAt ? current : best;
    });
  }

  /**
   * Lazily resolve and cache the bot admin's database UUID.
   * Typically 1 DB query per PersonalityLoader instance lifetime,
   * only triggered when a name collision actually occurs.
   * Not cached when admin isn't found (may register later) or on error.
   */
  private async resolveBotAdminUuid(): Promise<string | null> {
    if (this.botAdminUuid !== undefined) {
      return this.botAdminUuid;
    }

    const config = getConfig();
    if (config.BOT_OWNER_ID === undefined || config.BOT_OWNER_ID === '') {
      this.botAdminUuid = null;
      return null;
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { discordId: config.BOT_OWNER_ID },
        select: { id: true },
      });
      // Only cache when admin is found — they may not have registered yet
      if (user !== null) {
        this.botAdminUuid = user.id;
      }
      return user?.id ?? null;
    } catch (err) {
      logger.warn(
        { err },
        '[PersonalityLoader] Failed to resolve bot admin UUID, skipping admin preference'
      );
      // Don't cache — allow retry on next collision
      return null;
    }
  }

  /**
   * Load the global default LLM config — the fallback for a personality with no
   * defaultConfigLink. Resolves the AdminSettings global-default POINTER relation
   * (`globalDefaultLlmConfig`), NOT the stale `isDefault` column.
   *
   * @returns MappedLlmConfig with ALL params from advancedParameters JSONB, or null if the pointer is unset
   */
  async loadGlobalDefaultConfig(): Promise<MappedLlmConfig | null> {
    try {
      // The global default is the AdminSettings.globalDefaultLlmConfig POINTER
      // relation (S3), not the `isDefault` column — `setAsDefault` writes only the
      // pointer, so the boolean column is stale. Resolve the pointer's target in a
      // single nested-select query, matching config-resolver's LlmConfigResolver /
      // VisionConfigResolver idiom. (The old `isDefault:true` query was also
      // ambiguous across the per-kind defaults; the pointer names the chat/text
      // default unambiguously.) onDelete:SetNull → a null relation means "unset".
      const settings = await this.prisma.adminSettings.findUnique({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        select: { globalDefaultLlmConfig: { select: LLM_CONFIG_SELECT } }, // Uses advancedParameters JSONB
      });
      const globalDefault = settings?.globalDefaultLlmConfig ?? null;

      if (globalDefault === null) {
        logger.warn('[PersonalityLoader] No global default LLM config set');
        return null;
      }

      // Map the raw DB result to application format using the shared mapper
      const mappedConfig = mapLlmConfigFromDb(globalDefault);

      logger.info(
        { model: mappedConfig.model },
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

      logger.info({ count: dbPersonalities.length }, 'Loaded personalities from database');
      return dbPersonalities;
    } catch (error) {
      logger.error({ err: error }, 'Failed to load all personalities from database');
      return [];
    }
  }
}
