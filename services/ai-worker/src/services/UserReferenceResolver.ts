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

import type { PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('UserReferenceResolver');

/**
 * Resolved persona info for a user reference
 */
export interface ResolvedPersona {
  /** Persona UUID */
  personaId: string;
  /** Display name (preferredName or name) */
  personaName: string;
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
   * Resolve persona by shapes.inc user ID
   *
   * Looks up the shapes_persona_mappings table to find the mapped persona.
   */
  private async resolveByShapesUserId(shapesUserId: string): Promise<ResolvedPersona | null> {
    try {
      const mapping = await this.prisma.shapesPersonaMapping.findUnique({
        where: { shapesUserId },
        include: {
          persona: {
            select: {
              id: true,
              name: true,
              preferredName: true,
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
      const user = await this.prisma.user.findUnique({
        where: { discordId },
        include: {
          defaultPersona: {
            select: {
              id: true,
              name: true,
              preferredName: true,
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
        content: user.defaultPersona.content ?? '',
      };
    } catch (error) {
      logger.error({ err: error, username }, '[UserReferenceResolver] Error resolving username');
      return null;
    }
  }
}
