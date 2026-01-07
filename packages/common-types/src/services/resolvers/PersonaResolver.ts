/**
 * PersonaResolver - Resolves user persona for AI interactions
 *
 * Implements the "Switch" strategy: returns the entire persona object,
 * no field-level merging with defaults.
 *
 * Resolution hierarchy:
 * 1. Per-personality override (UserPersonalityConfig.personaId)
 * 2. User's default persona (User.defaultPersonaId)
 * 3. Auto-default: First owned persona (lazy initialization - persists the default)
 *
 * The auto-default feature ensures users always have a persona without
 * requiring explicit setup. On first resolution, if no default is set,
 * the user's first owned persona becomes their default.
 */

import { createLogger } from '../../utils/logger.js';
import { isValidUUID, UUID_REGEX } from '../../constants/service.js';
import type { PrismaClient } from '../prisma.js';
import { BaseConfigResolver, type ResolutionResult } from './BaseConfigResolver.js';

const logger = createLogger('PersonaResolver');

/**
 * Resolved persona data
 */
export interface ResolvedPersona {
  /** Persona UUID */
  personaId: string;
  /** Persona name (profile name) */
  personaName: string;
  /** User's preferred name */
  preferredName: string | null;
  /** User's pronouns */
  pronouns: string | null;
  /** Persona content/description */
  content: string;
  /** Whether to share LTM across all personalities */
  shareLtmAcrossPersonalities: boolean;
}

/**
 * Lightweight persona info (just ID and LTM flag) for memory queries
 */
export interface PersonaMemoryInfo {
  personaId: string;
  shareLtmAcrossPersonalities: boolean;
}

/**
 * System default when no persona exists (should rarely happen)
 */
const SYSTEM_DEFAULT_PERSONA: ResolvedPersona = {
  personaId: '',
  personaName: '',
  preferredName: null,
  pronouns: null,
  content: '',
  shareLtmAcrossPersonalities: false,
};

/**
 * PersonaResolver - resolves user persona with auto-default initialization
 */
export class PersonaResolver extends BaseConfigResolver<ResolvedPersona> {
  protected readonly resolverName = 'PersonaResolver';

  constructor(prisma: PrismaClient, options?: { cacheTtlMs?: number; enableCleanup?: boolean }) {
    super(prisma, options);
  }

  /**
   * Resolve persona for memory retrieval (lightweight - just ID and LTM flag)
   *
   * This is optimized for the memory retrieval path where we don't need
   * the full persona content, just the ID and sharing preference.
   */
  async resolveForMemory(
    discordUserId: string,
    personalityId: string
  ): Promise<PersonaMemoryInfo | null> {
    const result = await this.resolve(discordUserId, personalityId);

    if (result.source === 'system-default' || result.config.personaId === '') {
      return null;
    }

    return {
      personaId: result.config.personaId,
      shareLtmAcrossPersonalities: result.config.shareLtmAcrossPersonalities,
    };
  }

  /**
   * Resolve full persona configuration
   */
  protected async resolveFresh(
    discordUserId: string,
    personalityId?: string
  ): Promise<ResolutionResult<ResolvedPersona>> {
    // Get user with their default persona and owned personas
    const user = await this.prisma.user.findUnique({
      where: { discordId: discordUserId },
      select: {
        id: true,
        defaultPersonaId: true,
        defaultPersona: {
          select: {
            id: true,
            name: true,
            preferredName: true,
            pronouns: true,
            content: true,
            shareLtmAcrossPersonalities: true,
          },
        },
        ownedPersonas: {
          select: {
            id: true,
            name: true,
            preferredName: true,
            pronouns: true,
            content: true,
            shareLtmAcrossPersonalities: true,
          },
          orderBy: { createdAt: 'asc' },
          take: 1, // Only need first for auto-default
        },
      },
    });

    if (user === null) {
      logger.warn({ discordUserId }, 'User not found');
      return { config: this.getSystemDefault(), source: 'system-default' };
    }

    // Priority 1: Per-personality override (separate query for cleaner typing)
    if (personalityId !== undefined && personalityId !== '') {
      const personaOverride = await this.prisma.userPersonalityConfig.findFirst({
        where: {
          userId: user.id,
          personalityId,
          personaId: { not: null },
        },
        select: {
          persona: {
            select: {
              id: true,
              name: true,
              preferredName: true,
              pronouns: true,
              content: true,
              shareLtmAcrossPersonalities: true,
            },
          },
        },
      });

      if (personaOverride?.persona) {
        logger.debug(
          { discordUserId, personalityId, personaId: personaOverride.persona.id },
          'Using personality-specific persona override'
        );
        return {
          config: this.mapToResolvedPersona(personaOverride.persona),
          source: 'context-override',
          sourceName: `override:${personalityId}`,
        };
      }
    }

    // Priority 2: User's explicit default
    if (user.defaultPersona) {
      return {
        config: this.mapToResolvedPersona(user.defaultPersona),
        source: 'user-default',
        sourceName: 'user-default',
      };
    }

    // Priority 3: Auto-default - use first owned persona and persist it
    if (user.ownedPersonas.length > 0) {
      const firstPersona = user.ownedPersonas[0];

      // Persist as default for future lookups (lazy initialization)
      await this.setUserDefault(user.id, firstPersona.id);

      logger.debug(
        { discordUserId, personaId: firstPersona.id },
        'Auto-defaulted to first owned persona'
      );

      return {
        config: this.mapToResolvedPersona(firstPersona),
        source: 'user-default', // Treat as user-default since we just set it
        sourceName: 'auto-default',
      };
    }

    // No persona at all
    logger.warn({ discordUserId }, 'User has no personas');
    return { config: this.getSystemDefault(), source: 'system-default' };
  }

  /**
   * Set user's default persona (for auto-default and explicit setting)
   */
  private async setUserDefault(internalUserId: string, personaId: string): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: internalUserId },
        data: { defaultPersonaId: personaId },
      });
    } catch (error) {
      logger.error(
        { err: error, userId: internalUserId, personaId },
        'Failed to set default persona'
      );
      // Don't throw - this is a best-effort optimization
    }
  }

  /**
   * Map database persona to resolved persona
   */
  private mapToResolvedPersona(persona: {
    id: string;
    name: string;
    preferredName: string | null;
    pronouns: string | null;
    content: string;
    shareLtmAcrossPersonalities: boolean;
  }): ResolvedPersona {
    return {
      personaId: persona.id,
      personaName: persona.name,
      preferredName: persona.preferredName,
      pronouns: persona.pronouns,
      content: persona.content,
      shareLtmAcrossPersonalities: persona.shareLtmAcrossPersonalities,
    };
  }

  /**
   * Get system default (empty persona)
   */
  protected getSystemDefault(): ResolvedPersona {
    return SYSTEM_DEFAULT_PERSONA;
  }

  /**
   * Get persona content formatted for prompt injection
   *
   * Accepts either a UUID personaId or a 'discord:XXXX' format ID.
   * For discord: format, returns null (caller should resolve to UUID first).
   */
  async getPersonaContentForPrompt(personaId: string): Promise<string | null> {
    // Extended context participants use 'discord:XXXX' format, not UUIDs
    // These need to be resolved by the caller using resolveDiscordIdToPersona first
    if (!isValidUUID(personaId)) {
      // Not a UUID - can't look up directly. Caller should resolve first.
      return null;
    }

    try {
      const persona = await this.prisma.persona.findUnique({
        where: { id: personaId },
        select: {
          preferredName: true,
          pronouns: true,
          content: true,
        },
      });

      if (persona === null) {
        return null;
      }

      // Build persona context with structured fields
      const parts: string[] = [];

      if (persona.preferredName !== null && persona.preferredName.length > 0) {
        parts.push(`Name: ${persona.preferredName}`);
      }

      if (persona.pronouns !== null && persona.pronouns.length > 0) {
        parts.push(`Pronouns: ${persona.pronouns}`);
      }

      if (persona.content !== null && persona.content.length > 0) {
        parts.push(persona.content);
      }

      return parts.length > 0 ? parts.join('\n') : null;
    } catch (error) {
      logger.error({ err: error, personaId }, 'Failed to get persona content');
      return null;
    }
  }

  /**
   * Resolve a personaId that may be in 'discord:XXXX' format to an actual persona UUID.
   *
   * Extended context participants use 'discord:{discordUserId}' format instead of UUIDs.
   * This method resolves them to actual persona UUIDs if the user is registered.
   *
   * @param personaId - Either a UUID or 'discord:XXXX' format ID
   * @param personalityId - The personality context (needed for per-personality overrides)
   * @returns The resolved UUID personaId, or null if user has no persona
   */
  async resolveToUuid(personaId: string, personalityId: string): Promise<string | null> {
    // Already a valid UUID - return as-is
    // Note: Use regex directly to avoid type guard narrowing personaId to 'never' in else branch
    if (UUID_REGEX.test(personaId)) {
      return personaId;
    }

    // Check for discord: prefix format
    if (personaId.startsWith('discord:')) {
      const discordUserId = personaId.slice(8); // Remove 'discord:' prefix

      // Resolve using the standard resolution flow
      const result = await this.resolve(discordUserId, personalityId);

      // If we got a system default (no persona), return null
      if (result.source === 'system-default' || result.config.personaId === '') {
        return null;
      }

      logger.debug(
        { originalId: personaId, resolvedId: result.config.personaId },
        'Resolved discord: format personaId to UUID'
      );

      return result.config.personaId;
    }

    // Unknown format
    logger.warn({ personaId }, 'Unknown personaId format - not UUID or discord: prefix');
    return null;
  }
}
