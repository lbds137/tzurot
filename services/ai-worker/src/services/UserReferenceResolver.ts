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
export interface ResolvedPersona {
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
export interface UserReferenceResolutionResult {
  /** Text with all user references replaced with persona names */
  processedText: string;
  /** Personas that were resolved (for adding to participants) */
  resolvedPersonas: ResolvedPersona[];
}

/**
 * Result of resolving user references across all personality fields
 */
export interface PersonalityResolutionResult {
  /** Personality with all text fields resolved */
  resolvedPersonality: LoadedPersonality;
  /** Deduplicated personas found across all fields (for adding to participants) */
  resolvedPersonas: ResolvedPersona[];
}

/**
 * Regex patterns for user reference formats
 */
const USER_REFERENCE_PATTERNS = {
  // @[username](user:uuid) - Shapes.inc markdown format
  // Captures: [1] = username, [2] = shapes_user_id (UUID)
  SHAPES_MARKDOWN: /@\[([^\]]+)\]\(user:([a-f0-9-]{36})\)/gi,

  // <@discord_id> - Discord mention format
  // Captures: [1] = discord_id (snowflake)
  DISCORD_MENTION: /<@!?(\d{17,20})>/g,

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

    // 1. Resolve shapes.inc markdown format: @[username](user:uuid)
    for (const match of [...text.matchAll(USER_REFERENCE_PATTERNS.SHAPES_MARKDOWN)]) {
      const [fullMatch, username, shapesUserId] = match;
      const persona = await this.resolveByShapesUserId(shapesUserId);
      applyResult(
        this.processMatch({
          ctx,
          fullMatch,
          persona,
          logContext: { shapesUserId },
          refType: 'shapes.inc',
          fallbackName: username,
        })
      );
    }

    // 2. Resolve Discord mention format: <@discord_id>
    for (const match of [...ctx.currentText.matchAll(USER_REFERENCE_PATTERNS.DISCORD_MENTION)]) {
      const [fullMatch, discordId] = match;
      const persona = await this.resolveByDiscordId(discordId);
      applyResult(
        this.processMatch({
          ctx,
          fullMatch,
          persona,
          logContext: { discordId },
          refType: 'Discord',
        })
      );
    }

    // 3. Resolve simple username format: @username
    for (const match of [...ctx.currentText.matchAll(USER_REFERENCE_PATTERNS.SIMPLE_USERNAME)]) {
      const [fullMatch, username] = match;
      const persona = await this.resolveByUsername(username);
      applyResult(
        this.processMatch({
          ctx,
          fullMatch,
          persona,
          logContext: { username },
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

  /**
   * Resolve persona by shapes.inc user ID
   *
   * Looks up the shapes_persona_mappings table to find the mapped persona.
   */
  private async resolveByShapesUserId(shapesUserId: string): Promise<ResolvedPersona | null> {
    try {
      // findUnique is inherently bounded (returns 0-1 rows by unique constraint)
      const mapping = await this.prisma.shapesPersonaMapping.findUnique({
        where: { shapesUserId },
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
      });

      if (!mapping?.persona) {
        logger.debug(
          { shapesUserId },
          '[UserReferenceResolver] No mapping found for shapes user ID'
        );
        return null;
      }

      return {
        personaId: mapping.persona.id,
        personaName: mapping.persona.preferredName ?? mapping.persona.name,
        preferredName: mapping.persona.preferredName,
        pronouns: mapping.persona.pronouns,
        content: mapping.persona.content ?? '',
      };
    } catch (error) {
      logger.error(
        { err: error, shapesUserId },
        '[UserReferenceResolver] Error resolving shapes user ID'
      );
      return null;
    }
  }

  /**
   * Resolve persona by Discord user ID
   *
   * Looks up the user by discordId and returns their default persona.
   */
  private async resolveByDiscordId(discordId: string): Promise<ResolvedPersona | null> {
    try {
      // findUnique is inherently bounded (returns 0-1 rows by unique constraint)
      const user = await this.prisma.user.findUnique({
        where: { discordId },
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
      });

      if (!user?.defaultPersona) {
        logger.debug({ discordId }, '[UserReferenceResolver] No user or default persona found');
        return null;
      }

      return {
        personaId: user.defaultPersona.id,
        personaName: user.defaultPersona.preferredName ?? user.defaultPersona.name,
        preferredName: user.defaultPersona.preferredName,
        pronouns: user.defaultPersona.pronouns,
        content: user.defaultPersona.content ?? '',
      };
    } catch (error) {
      logger.error({ err: error, discordId }, '[UserReferenceResolver] Error resolving Discord ID');
      return null;
    }
  }

  /**
   * Resolve persona by username
   *
   * Looks up the user by username and returns their default persona.
   */
  private async resolveByUsername(username: string): Promise<ResolvedPersona | null> {
    try {
      const user = await this.prisma.user.findFirst({
        where: { username: { equals: username, mode: 'insensitive' } },
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
        orderBy: { createdAt: 'asc' }, // Stable ordering per CLAUDE.md bounded data access
        take: 1,
      });

      if (!user?.defaultPersona) {
        logger.debug({ username }, '[UserReferenceResolver] No user or default persona found');
        return null;
      }

      return {
        personaId: user.defaultPersona.id,
        personaName: user.defaultPersona.preferredName ?? user.defaultPersona.name,
        preferredName: user.defaultPersona.preferredName,
        pronouns: user.defaultPersona.pronouns,
        content: user.defaultPersona.content ?? '',
      };
    } catch (error) {
      logger.error({ err: error, username }, '[UserReferenceResolver] Error resolving username');
      return null;
    }
  }
}
