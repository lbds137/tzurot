/**
 * User Reference Resolver
 *
 * Resolves user references in system prompts from shapes.inc format to persona names.
 * Supports three reference formats:
 * 1. @[username](user:shapes_uuid) - Shapes.inc markdown format
 * 2. @username - Simple username mention
 * 3. <@discord_id> - Discord mention format
 *
 * For each resolved reference:
 * - Replaces the reference with the user's default persona's preferredName
 * - Returns the persona info for inclusion in the participants section
 */

import type { PrismaClient, LoadedPersonality } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('UserReferenceResolver');

/**
 * Personality text fields that may contain user references and should be resolved.
 * These are the character definition fields that could have shapes.inc format mentions.
 */
const RESOLVABLE_PERSONALITY_FIELDS: (keyof LoadedPersonality)[] = [
  'systemPrompt',
  'characterInfo',
  'personalityTraits',
  'personalityTone',
  'personalityAge',
  'personalityAppearance',
  'personalityLikes',
  'personalityDislikes',
  'conversationalGoals',
  'conversationalExamples',
];

/**
 * Type-safe helper to set a personality field value.
 * Isolates the type assertion needed for dynamic key access.
 */
function setPersonalityField(
  personality: LoadedPersonality,
  key: keyof LoadedPersonality,
  value: string
): void {
  // Cast to Record for dynamic key assignment - safe since key is keyof LoadedPersonality
  (personality as Record<string, unknown>)[key] = value;
}

/**
 * Resolved persona info for a user reference
 */
interface ResolvedPersona {
  /** Persona UUID */
  personaId: string;
  /** Display name (preferredName or name) */
  personaName: string;
  /** User's preferred name (may be null if not set) */
  preferredName: string | null;
  /** User's pronouns (may be null if not set) */
  pronouns: string | null;
  /** Persona content/description for participants section */
  content: string;
}

/**
 * Result of resolving user references in text
 */
interface UserReferenceResolutionResult {
  /** Text with all user references replaced with persona names */
  processedText: string;
  /** Personas that were resolved (for adding to participants) */
  resolvedPersonas: ResolvedPersona[];
}

/**
 * Result of resolving user references across all personality fields
 */
interface PersonalityResolutionResult {
  /** Personality with all text fields resolved */
  resolvedPersonality: LoadedPersonality;
  /** Deduplicated personas found across all fields (for adding to participants) */
  resolvedPersonas: ResolvedPersona[];
}

/**
 * Discord snowflake ID length constraints.
 * Snowflakes are Twitter-style 64-bit IDs introduced in 2015.
 * - MIN_LENGTH: 17 digits covers IDs from Discord's 2015 launch
 * - MAX_LENGTH: 20 digits is the max for 64-bit unsigned integers
 */
const DISCORD_SNOWFLAKE_LENGTH = { MIN: 17, MAX: 20 } as const;

/**
 * Regex patterns for user reference formats
 */
const USER_REFERENCE_PATTERNS = {
  // @[username](user:uuid) - Shapes.inc markdown format
  // Captures: [1] = username, [2] = shapes_user_id (UUID)
  SHAPES_MARKDOWN: /@\[([^\]]+)\]\(user:([a-f0-9-]{36})\)/gi,

  // <@discord_id> - Discord mention format
  // Captures: [1] = discord_id (snowflake)
  DISCORD_MENTION: new RegExp(
    `<@!?(\\d{${DISCORD_SNOWFLAKE_LENGTH.MIN},${DISCORD_SNOWFLAKE_LENGTH.MAX}})>`,
    'g'
  ),

  // @username - Simple username mention (word boundary to avoid false positives)
  // Must not be followed by [ (which would make it shapes format)
  // Must not be preceded by < (which would make it discord format)
  // Captures: [1] = username
  SIMPLE_USERNAME: /(?<!<)@(\w+)(?!\[)/g,
};

/** Context for processing a single match */
interface MatchContext {
  currentText: string;
  seenPersonaIds: Set<string>;
  resolvedPersonas: ResolvedPersona[];
  activePersonaId: string | undefined;
}

/** Result of processing a single match */
interface MatchResult {
  updatedText: string;
  /** Persona to add to results (null if already seen, self-reference, or not found) */
  persona: ResolvedPersona | null;
  /** Persona ID to mark as seen (null if already seen or not found) */
  markAsSeen: string | null;
}

/** Options for processing a match */
interface ProcessMatchOptions {
  ctx: MatchContext;
  fullMatch: string;
  persona: ResolvedPersona | null;
  logContext: Record<string, unknown>;
  refType: string;
  fallbackName?: string;
}

export class UserReferenceResolver {
  constructor(private prisma: PrismaClient) {}

  // ============================================================================
  // BATCH RESOLUTION METHODS
  // These resolve multiple IDs in a single database query to avoid N+1 patterns
  // ============================================================================

  /**
   * Batch resolve personas by shapes.inc user IDs
   *
   * Looks up multiple shapes user IDs in a single query and returns a map.
   */
  private async batchResolveByShapesUserIds(
    shapesUserIds: string[]
  ): Promise<Map<string, ResolvedPersona>> {
    const result = new Map<string, ResolvedPersona>();
    if (shapesUserIds.length === 0) {
      return result;
    }

    try {
      const mappings = await this.prisma.shapesPersonaMapping.findMany({
        where: { shapesUserId: { in: shapesUserIds } },
        include: {
          persona: {
            select: {
              id: true,
              name: true,
              preferredName: true,
              pronouns: true,
              content: true,
            },
          },
        },
        take: shapesUserIds.length, // Bounded by input size
      });

      for (const mapping of mappings) {
        if (mapping.persona !== null) {
          result.set(mapping.shapesUserId, {
            personaId: mapping.persona.id,
            personaName: mapping.persona.preferredName ?? mapping.persona.name,
            preferredName: mapping.persona.preferredName,
            pronouns: mapping.persona.pronouns,
            content: mapping.persona.content ?? '',
          });
        }
      }
    } catch (error) {
      logger.error(
        { err: error, count: shapesUserIds.length },
        '[UserReferenceResolver] Error batch resolving shapes user IDs'
      );
    }

    return result;
  }

  /**
   * Batch resolve personas by Discord user IDs
   *
   * Looks up multiple Discord user IDs in a single query and returns a map.
   */
  private async batchResolveByDiscordIds(
    discordIds: string[]
  ): Promise<Map<string, ResolvedPersona>> {
    const result = new Map<string, ResolvedPersona>();
    if (discordIds.length === 0) {
      return result;
    }

    try {
      const users = await this.prisma.user.findMany({
        where: { discordId: { in: discordIds } },
        include: {
          defaultPersona: {
            select: {
              id: true,
              name: true,
              preferredName: true,
              pronouns: true,
              content: true,
            },
          },
        },
        take: discordIds.length, // Bounded by input size
      });

      for (const user of users) {
        if (user.defaultPersona !== null) {
          result.set(user.discordId, {
            personaId: user.defaultPersona.id,
            personaName: user.defaultPersona.preferredName ?? user.defaultPersona.name,
            preferredName: user.defaultPersona.preferredName,
            pronouns: user.defaultPersona.pronouns,
            content: user.defaultPersona.content ?? '',
          });
        }
      }
    } catch (error) {
      logger.error(
        { err: error, count: discordIds.length },
        '[UserReferenceResolver] Error batch resolving Discord IDs'
      );
    }

    return result;
  }

  /**
   * Batch resolve personas by usernames
   *
   * Looks up multiple usernames in a single query and returns a map.
   * Uses case-insensitive matching. For duplicate case-insensitive matches,
   * keeps the first (oldest) user for consistency.
   */
  private async batchResolveByUsernames(
    usernames: string[]
  ): Promise<Map<string, ResolvedPersona>> {
    const result = new Map<string, ResolvedPersona>();
    if (usernames.length === 0) {
      return result;
    }

    try {
      // For case-insensitive batch lookup, use OR conditions for each username
      const users = await this.prisma.user.findMany({
        where: {
          OR: usernames.map(username => ({
            username: { equals: username, mode: 'insensitive' as const },
          })),
        },
        include: {
          defaultPersona: {
            select: {
              id: true,
              name: true,
              preferredName: true,
              pronouns: true,
              content: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: Math.min(usernames.length * 2, 1000), // Allow buffer for case variants, capped for safety
      });

      // Group by lowercase username to handle case-insensitive matches
      // Keep only the first (oldest) user per case-insensitive username
      const seenUsernames = new Set<string>();

      for (const user of users) {
        const lowerUsername = user.username.toLowerCase();

        // Skip if we already have a match for this case-insensitive username
        if (seenUsernames.has(lowerUsername)) {
          continue;
        }

        if (user.defaultPersona !== null) {
          // Find the original case username from input that matches
          const matchingInput = usernames.find(u => u.toLowerCase() === lowerUsername);
          if (matchingInput !== undefined) {
            seenUsernames.add(lowerUsername);
            result.set(matchingInput, {
              personaId: user.defaultPersona.id,
              personaName: user.defaultPersona.preferredName ?? user.defaultPersona.name,
              preferredName: user.defaultPersona.preferredName,
              pronouns: user.defaultPersona.pronouns,
              content: user.defaultPersona.content ?? '',
            });
          }
        }
      }
    } catch (error) {
      logger.error(
        { err: error, count: usernames.length },
        '[UserReferenceResolver] Error batch resolving usernames'
      );
    }

    return result;
  }

  /**
   * Process a single match (pure function - no mutations)
   * Returns the updated text, persona to add, and ID to mark as seen
   */
  private processMatch(opts: ProcessMatchOptions): MatchResult {
    const { ctx, fullMatch, persona, logContext, refType, fallbackName } = opts;

    // No persona found - use fallback or keep original
    if (persona === null) {
      const replacement = fallbackName ?? fullMatch;
      if (fallbackName !== undefined) {
        logger.debug(
          { ...logContext, fallbackName },
          `[UserReferenceResolver] No mapping found, falling back to username`
        );
      }
      return {
        updatedText: ctx.currentText.replaceAll(fullMatch, replacement),
        persona: null,
        markAsSeen: null,
      };
    }

    const updatedText = ctx.currentText.replaceAll(fullMatch, persona.personaName);

    // Already seen - just update text, don't add again
    if (ctx.seenPersonaIds.has(persona.personaId)) {
      return { updatedText, persona: null, markAsSeen: null };
    }

    // Self-reference - mark as seen but don't add to participants
    if (persona.personaId === ctx.activePersonaId) {
      logger.debug(
        { ...logContext, personaName: persona.personaName },
        `[UserReferenceResolver] Resolved ${refType} self-reference (not adding to participants)`
      );
      return { updatedText, persona: null, markAsSeen: persona.personaId };
    }

    // Normal case - add persona and mark as seen
    logger.debug(
      { ...logContext, personaName: persona.personaName },
      `[UserReferenceResolver] Resolved ${refType} reference`
    );
    return { updatedText, persona, markAsSeen: persona.personaId };
  }

  /**
   * Resolve all user references in text
   *
   * Processes the text to find user references in any supported format,
   * looks up the user's default persona, and replaces references with persona names.
   *
   * Uses batch queries to avoid N+1 database access patterns - all matches of each
   * type are collected first, then resolved in a single query per type.
   *
   * @param text - Text containing user references
   * @param activePersonaId - Optional ID of the currently active persona (for self-reference detection)
   *                          If a reference resolves to this persona, the reference is replaced with the name
   *                          but the persona is NOT added to resolvedPersonas (to avoid adding yourself to participants)
   * @returns Processed text and list of resolved personas
   */
  async resolveUserReferences(
    text: string,
    activePersonaId?: string
  ): Promise<UserReferenceResolutionResult> {
    if (!text || text.length === 0) {
      return { processedText: text ?? '', resolvedPersonas: [] };
    }

    // Early exit: skip expensive regex if no reference patterns possible
    // This is a hot path optimization - most AI responses don't contain references
    if (!text.includes('@') && !text.includes('<@')) {
      return { processedText: text, resolvedPersonas: [] };
    }

    // ========================================================================
    // PHASE 1: Extract all matches (no DB queries yet)
    // ========================================================================

    // Shapes.inc format: @[username](user:uuid)
    const shapesMatches = [...text.matchAll(USER_REFERENCE_PATTERNS.SHAPES_MARKDOWN)].map(
      match => ({
        fullMatch: match[0],
        username: match[1],
        shapesUserId: match[2],
      })
    );

    // Discord format: <@discord_id>
    const discordMatches = [...text.matchAll(USER_REFERENCE_PATTERNS.DISCORD_MENTION)].map(
      match => ({
        fullMatch: match[0],
        discordId: match[1],
      })
    );

    // Simple username format: @username
    const usernameMatches = [...text.matchAll(USER_REFERENCE_PATTERNS.SIMPLE_USERNAME)].map(
      match => ({
        fullMatch: match[0],
        username: match[1],
      })
    );

    // ========================================================================
    // PHASE 2: Batch resolve all IDs in parallel (3 queries max instead of N)
    // ========================================================================

    const uniqueShapesIds = [...new Set(shapesMatches.map(m => m.shapesUserId))];
    const uniqueDiscordIds = [...new Set(discordMatches.map(m => m.discordId))];
    const uniqueUsernames = [...new Set(usernameMatches.map(m => m.username))];

    const [shapesMap, discordMap, usernameMap] = await Promise.all([
      this.batchResolveByShapesUserIds(uniqueShapesIds),
      this.batchResolveByDiscordIds(uniqueDiscordIds),
      this.batchResolveByUsernames(uniqueUsernames),
    ]);

    // ========================================================================
    // PHASE 3: Apply resolutions to text
    // ========================================================================

    const ctx: MatchContext = {
      currentText: text,
      seenPersonaIds: new Set<string>(),
      resolvedPersonas: [],
      activePersonaId,
    };

    // Helper to apply result to context (explicit mutation in one place)
    const applyResult = (result: MatchResult): void => {
      ctx.currentText = result.updatedText;
      if (result.markAsSeen !== null) {
        ctx.seenPersonaIds.add(result.markAsSeen);
      }
      if (result.persona !== null) {
        ctx.resolvedPersonas.push(result.persona);
      }
    };

    // 1. Apply shapes.inc resolutions
    for (const match of shapesMatches) {
      const persona = shapesMap.get(match.shapesUserId) ?? null;
      applyResult(
        this.processMatch({
          ctx,
          fullMatch: match.fullMatch,
          persona,
          logContext: { shapesUserId: match.shapesUserId },
          refType: 'shapes.inc',
          fallbackName: match.username,
        })
      );
    }

    // 2. Apply Discord resolutions
    for (const match of discordMatches) {
      const persona = discordMap.get(match.discordId) ?? null;
      applyResult(
        this.processMatch({
          ctx,
          fullMatch: match.fullMatch,
          persona,
          logContext: { discordId: match.discordId },
          refType: 'Discord',
        })
      );
    }

    // 3. Apply username resolutions
    for (const match of usernameMatches) {
      const persona = usernameMap.get(match.username) ?? null;
      applyResult(
        this.processMatch({
          ctx,
          fullMatch: match.fullMatch,
          persona,
          logContext: { username: match.username },
          refType: 'username',
        })
      );
    }

    if (ctx.resolvedPersonas.length > 0) {
      logger.info(
        {
          count: ctx.resolvedPersonas.length,
          personas: ctx.resolvedPersonas.map(p => p.personaName),
        },
        '[UserReferenceResolver] Resolved user references in prompt'
      );
    }

    return { processedText: ctx.currentText, resolvedPersonas: ctx.resolvedPersonas };
  }

  /**
   * Resolve user references across all personality text fields
   *
   * Processes all character definition fields (systemPrompt, characterInfo, etc.)
   * in parallel, replacing user references with persona names. Returns the
   * resolved personality and a deduplicated list of discovered personas.
   *
   * @param personality - The personality with text fields to resolve
   * @param activePersonaId - Optional ID to exclude from participants (self-reference)
   * @returns Resolved personality and deduplicated personas
   */
  async resolvePersonalityReferences(
    personality: LoadedPersonality,
    activePersonaId?: string
  ): Promise<PersonalityResolutionResult> {
    // Create a shallow copy to avoid mutating the original
    const resolvedPersonality = { ...personality };

    // Use a Map to deduplicate personas by ID across all fields
    const personaMap = new Map<string, ResolvedPersona>();

    // Process all fields in parallel for performance
    // Use Promise.allSettled for resilience - if one field fails, others still resolve
    const processingPromises = RESOLVABLE_PERSONALITY_FIELDS.map(async key => {
      const originalText = personality[key];

      // Skip if field is undefined, null, or not a string
      if (originalText === undefined || originalText === null || typeof originalText !== 'string') {
        return { key, skipped: true };
      }

      // Skip empty strings
      if (originalText.length === 0) {
        return { key, skipped: true };
      }

      const { processedText, resolvedPersonas } = await this.resolveUserReferences(
        originalText,
        activePersonaId
      );

      return { key, processedText, resolvedPersonas };
    });

    const results = await Promise.allSettled(processingPromises);

    // Track failed fields for aggregated error logging
    const failedFields: string[] = [];

    // Process results
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const fieldName = RESOLVABLE_PERSONALITY_FIELDS[i];

      if (result.status === 'rejected') {
        failedFields.push(fieldName as string);
        logger.warn(
          { field: fieldName, error: result.reason, personalityId: personality.id },
          '[UserReferenceResolver] Failed to resolve user references in personality field'
        );
        continue;
      }

      const value = result.value;
      if (value.skipped === true || value.processedText === undefined) {
        continue;
      }

      // Update the field on the resolved personality
      setPersonalityField(resolvedPersonality, value.key, value.processedText);

      // Aggregate found personas (deduplicated by personaId)
      for (const persona of value.resolvedPersonas) {
        personaMap.set(persona.personaId, persona);
      }
    }

    // Log aggregated error summary if any fields failed
    if (failedFields.length > 0) {
      logger.error(
        { failedFields, failedCount: failedFields.length, personalityId: personality.id },
        '[UserReferenceResolver] Some personality fields failed to resolve user references'
      );
    }

    const allResolvedPersonas = Array.from(personaMap.values());

    if (allResolvedPersonas.length > 0) {
      logger.info(
        {
          personalityId: personality.id,
          count: allResolvedPersonas.length,
          personas: allResolvedPersonas.map(p => p.personaName),
        },
        '[UserReferenceResolver] Resolved user references across personality fields'
      );
    }

    return {
      resolvedPersonality,
      resolvedPersonas: allResolvedPersonas,
    };
  }
}
