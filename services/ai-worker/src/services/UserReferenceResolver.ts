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

export class UserReferenceResolver {
  constructor(private prisma: PrismaClient) {}

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
    // Early return for empty or undefined text
    if (!text || text.length === 0) {
      return { processedText: text ?? '', resolvedPersonas: [] };
    }

    const resolvedPersonas: ResolvedPersona[] = [];
    const seenPersonaIds = new Set<string>();
    let processedText = text;

    // 1. Resolve shapes.inc markdown format: @[username](user:uuid)
    const shapesMatches = [...text.matchAll(USER_REFERENCE_PATTERNS.SHAPES_MARKDOWN)];
    for (const match of shapesMatches) {
      const [fullMatch, username, shapesUserId] = match;
      const persona = await this.resolveByShapesUserId(shapesUserId);
      if (persona !== null && !seenPersonaIds.has(persona.personaId)) {
        // Use replaceAll to handle duplicate references to the same user
        processedText = processedText.replaceAll(fullMatch, persona.personaName);
        seenPersonaIds.add(persona.personaId);

        // Skip adding self-references to participants list
        if (persona.personaId === activePersonaId) {
          logger.debug(
            { shapesUserId, personaName: persona.personaName },
            '[UserReferenceResolver] Resolved shapes.inc self-reference (not adding to participants)'
          );
        } else {
          resolvedPersonas.push(persona);
          logger.debug(
            { shapesUserId, personaName: persona.personaName },
            '[UserReferenceResolver] Resolved shapes.inc reference'
          );
        }
      } else if (persona === null) {
        // Fallback: if no mapping found, use the username from the reference
        // This is better than leaving ugly @[username](user:uuid) in the prompt
        processedText = processedText.replaceAll(fullMatch, username);
        logger.debug(
          { shapesUserId, fallbackName: username },
          '[UserReferenceResolver] No mapping found, falling back to username'
        );
      }
    }

    // 2. Resolve Discord mention format: <@discord_id>
    const discordMatches = [...processedText.matchAll(USER_REFERENCE_PATTERNS.DISCORD_MENTION)];
    for (const match of discordMatches) {
      const [fullMatch, discordId] = match;
      const persona = await this.resolveByDiscordId(discordId);
      if (persona !== null && !seenPersonaIds.has(persona.personaId)) {
        // Use replaceAll to handle duplicate references to the same user
        processedText = processedText.replaceAll(fullMatch, persona.personaName);
        seenPersonaIds.add(persona.personaId);

        // Skip adding self-references to participants list
        if (persona.personaId === activePersonaId) {
          logger.debug(
            { discordId, personaName: persona.personaName },
            '[UserReferenceResolver] Resolved Discord self-reference (not adding to participants)'
          );
        } else {
          resolvedPersonas.push(persona);
          logger.debug(
            { discordId, personaName: persona.personaName },
            '[UserReferenceResolver] Resolved Discord mention'
          );
        }
      } else if (persona !== null) {
        // Already seen, just replace without adding to list
        processedText = processedText.replaceAll(fullMatch, persona.personaName);
      }
    }

    // 3. Resolve simple username format: @username
    const usernameMatches = [...processedText.matchAll(USER_REFERENCE_PATTERNS.SIMPLE_USERNAME)];
    for (const match of usernameMatches) {
      const [fullMatch, username] = match;
      const persona = await this.resolveByUsername(username);
      if (persona !== null && !seenPersonaIds.has(persona.personaId)) {
        // Use replaceAll to handle duplicate references to the same user
        processedText = processedText.replaceAll(fullMatch, persona.personaName);
        seenPersonaIds.add(persona.personaId);

        // Skip adding self-references to participants list
        if (persona.personaId === activePersonaId) {
          logger.debug(
            { username, personaName: persona.personaName },
            '[UserReferenceResolver] Resolved username self-reference (not adding to participants)'
          );
        } else {
          resolvedPersonas.push(persona);
          logger.debug(
            { username, personaName: persona.personaName },
            '[UserReferenceResolver] Resolved username mention'
          );
        }
      } else if (persona !== null) {
        // Already seen, just replace without adding to list
        processedText = processedText.replaceAll(fullMatch, persona.personaName);
      }
    }

    if (resolvedPersonas.length > 0) {
      logger.info(
        {
          count: resolvedPersonas.length,
          personas: resolvedPersonas.map(p => p.personaName),
        },
        '[UserReferenceResolver] Resolved user references in prompt'
      );
    }

    return { processedText, resolvedPersonas };
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
