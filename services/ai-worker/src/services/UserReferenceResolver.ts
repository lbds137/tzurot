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
import {
  RESOLVABLE_PERSONALITY_FIELDS,
  setPersonalityField,
  USER_REFERENCE_PATTERNS,
  type ResolvedPersona,
  type UserReferenceResolutionResult,
  type PersonalityResolutionResult,
  type MatchContext,
  type MatchResult,
  type ProcessMatchOptions,
} from './reference/UserReferencePatterns.js';
import {
  batchResolveByShapesUserIds,
  batchResolveByDiscordIds,
  batchResolveByUsernames,
} from './reference/BatchResolvers.js';

const logger = createLogger('UserReferenceResolver');

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
      batchResolveByShapesUserIds(this.prisma, uniqueShapesIds),
      batchResolveByDiscordIds(this.prisma, uniqueDiscordIds),
      batchResolveByUsernames(this.prisma, uniqueUsernames),
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
