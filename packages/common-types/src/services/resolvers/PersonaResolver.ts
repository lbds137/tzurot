/**
 * PersonaResolver - Resolves user persona for AI interactions
 *
 * Implements the "Switch" strategy: returns the entire persona object,
 * no field-level merging with defaults.
 *
 * Resolution is strictly READ-ONLY. Provisioning is the exclusive responsibility
 * of `UserService.getOrCreateUser`, which creates the user + default persona
 * atomically via a CTE. This resolver never writes; it picks the best persona
 * it can for the current request and returns it.
 *
 * Resolution hierarchy:
 * 1. Per-personality override (UserPersonalityConfig.personaId)
 * 2. User's explicit default (User.defaultPersonaId)
 * 3. Transient first-owned-persona fallback (warns, does NOT persist)
 * 4. System default (errors, user has no personas at all)
 *
 * Prior to the Identity Epic Phase 3 (2026-04-16), the Priority 3 branch
 * lazily persisted the first owned persona as the user's default. That lazy
 * mutation was dropped because: (a) it made a "read" path mutate state,
 * (b) errors were swallowed as "best-effort optimization" and became
 * invisible, (c) UserService already provisions `defaultPersonaId` atomically
 * at creation time (Phase 2), so the lazy-init code path is a transitional
 * compatibility shim rather than load-bearing logic.
 *
 * Post-Phase 5b, the Priority 3 branch should be unreachable in practice —
 * every user row has a non-null `defaultPersonaId` pointing to a real persona
 * (DB-enforced NOT NULL + Restrict FK). It remains as defense-in-depth for
 * any user row that somehow escapes the provisioning path (e.g., direct SQL
 * imports during sync). Transient resolution warns loudly so such orphans
 * are visible in logs.
 */

import { createLogger } from '../../utils/logger.js';
import { isValidUUID, UUID_REGEX } from '../../constants/service.js';
import type { PrismaClient } from '../prisma.js';
import { BaseConfigResolver, type ResolutionResult } from './BaseConfigResolver.js';

const logger = createLogger('PersonaResolver');

/** Resolution source constants (used for source field in ResolutionResult) */
const SOURCE_SYSTEM_DEFAULT = 'system-default' as const;
const SOURCE_USER_DEFAULT = 'user-default' as const;

/**
 * Resolved persona data
 * @public used in PersonaResolver public method signatures
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
}

/**
 * Lightweight persona info (just ID and focus mode) for memory queries
 * @public used in PersonaResolver public method signatures
 *
 * Note: shareLtmAcrossPersonalities was migrated to the config cascade
 * and is now read from ResolvedConfigOverrides instead of the persona.
 */
export interface PersonaMemoryInfo {
  personaId: string;
  /** Whether focus mode is enabled (disables LTM retrieval) */
  focusModeEnabled: boolean;
}

/**
 * Structured persona data for prompt inclusion
 * Each field is kept separate for proper XML formatting
 */
export interface PersonaPromptData {
  /** User's preferred display name */
  preferredName: string | null;
  /** User's pronouns */
  pronouns: string | null;
  /** User's persona content/about text */
  content: string;
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
   * Resolve persona for memory retrieval (lightweight - just ID, LTM flag, and focus mode)
   *
   * This is optimized for the memory retrieval path where we don't need
   * the full persona content, just the ID, sharing preference, and focus mode status.
   */
  async resolveForMemory(
    discordUserId: string,
    personalityId: string
  ): Promise<PersonaMemoryInfo | null> {
    const result = await this.resolve(discordUserId, personalityId);

    if (result.source === SOURCE_SYSTEM_DEFAULT || result.config.personaId === '') {
      return null;
    }

    // Query focusModeEnabled separately (it's per-user-per-personality, not part of persona)
    const focusModeEnabled = await this.getFocusModeStatus(discordUserId, personalityId);

    return {
      personaId: result.config.personaId,
      focusModeEnabled,
    };
  }

  /**
   * Check if focus mode is enabled for a user-personality combination
   * Focus mode disables LTM retrieval without affecting memory storage
   */
  private async getFocusModeStatus(discordUserId: string, personalityId: string): Promise<boolean> {
    try {
      // Get user's internal ID
      const user = await this.prisma.user.findUnique({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      if (user === null) {
        return false; // Default to disabled if user not found
      }

      // Check UserPersonalityConfig for focus mode (stored in configOverrides JSONB)
      const config = await this.prisma.userPersonalityConfig.findFirst({
        where: {
          userId: user.id,
          personalityId,
        },
        select: { configOverrides: true },
      });

      if (config?.configOverrides === null || config?.configOverrides === undefined) {
        return false;
      }
      const overrides = config.configOverrides as Record<string, unknown>;
      return overrides.focusModeEnabled === true;
    } catch (error) {
      logger.error(
        { err: error, discordUserId, personalityId },
        'Failed to get focus mode status, defaulting to disabled'
      );
      return false;
    }
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
          },
        },
        ownedPersonas: {
          select: {
            id: true,
            name: true,
            preferredName: true,
            pronouns: true,
            content: true,
          },
          orderBy: { createdAt: 'asc' },
          take: 1, // Only need first for auto-default
        },
      },
    });

    if (user === null) {
      logger.warn({ discordUserId }, 'User not found');
      return { config: this.getSystemDefault(), source: SOURCE_SYSTEM_DEFAULT };
    }

    // Priority 1: Per-personality override (separate query for cleaner typing)
    const override = await this.loadPersonalityOverride(user.id, discordUserId, personalityId);
    if (override !== null) {
      return override;
    }

    // Priority 2: User's explicit default
    if (user.defaultPersona) {
      return {
        config: this.mapToResolvedPersona(user.defaultPersona),
        source: SOURCE_USER_DEFAULT,
        sourceName: SOURCE_USER_DEFAULT,
      };
    }

    // Execution reaches here only when Priority 2 didn't return — meaning
    // `user.defaultPersona` is null. Post-Phase 5 this should be unreachable
    // at the DB level: the FK is `onDelete: Restrict` (so a referenced persona
    // can't be deleted) and Phase 5b made `defaultPersonaId` itself NOT NULL.
    // We log loudly here as a tripwire — hitting this branch means either the
    // DB drifted from its schema guarantees or db-sync imported a row in an
    // inconsistent state. Either way we fall through to owned-persona
    // resolution so the request still succeeds.
    if (user.defaultPersonaId !== null) {
      logger.error(
        { discordUserId, userId: user.id, defaultPersonaId: user.defaultPersonaId },
        'Dangling defaultPersonaId — references a non-existent persona. Falling through to owned-persona resolution.'
      );
    }

    // Priority 3: User has owned personas but no usable defaultPersona.
    // Transient resolution — pick the first owned persona without persisting.
    // Post-5b this branch should be unreachable in practice (NOT NULL +
    // Restrict FK guarantee every user has a valid defaultPersonaId), but
    // remains as defense-in-depth for any row that escapes UserService's
    // provisioning path (e.g., direct SQL from db-sync).
    if (user.ownedPersonas.length > 0) {
      const firstPersona = user.ownedPersonas[0];
      // NOTE: the query above uses `take: 1`, so `user.ownedPersonas` holds
      // at most one row — we can't log a meaningful total here. If ops ever
      // needs a count, change the query to `count` alongside the `take: 1`
      // fetch rather than reading `.length` (which would be misleading).
      logger.warn(
        {
          discordUserId,
          userId: user.id,
          selectedPersonaId: firstPersona.id,
        },
        'Transient resolution — user has owned personas but no defaultPersonaId. Post-5b this should be unreachable at the DB level; investigate how the row reached this state.'
      );
      return {
        config: this.mapToResolvedPersona(firstPersona),
        source: SOURCE_USER_DEFAULT,
        sourceName: 'transient-first-owned',
      };
    }

    // No persona at all — genuine data-integrity violation post-Phase-2.
    logger.error(
      { discordUserId, userId: user.id },
      'User has no personas — provisioning is incomplete. Check UserService.createUserWithDefaultPersona flow.'
    );
    return { config: this.getSystemDefault(), source: SOURCE_SYSTEM_DEFAULT };
  }

  /**
   * Look up the per-personality persona override. Returns null when the user
   * has no override for this personality (or no personalityId was provided).
   * Extracted to keep resolveFresh under the per-function line limit.
   */
  private async loadPersonalityOverride(
    userId: string,
    discordUserId: string,
    personalityId: string | undefined
  ): Promise<ResolutionResult<ResolvedPersona> | null> {
    if (personalityId === undefined || personalityId === '') {
      return null;
    }

    const personaOverride = await this.prisma.userPersonalityConfig.findFirst({
      where: {
        userId,
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
          },
        },
      },
    });

    if (!personaOverride?.persona) {
      return null;
    }

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

  /**
   * Map database persona to resolved persona
   */
  private mapToResolvedPersona(persona: {
    id: string;
    name: string;
    preferredName: string | null;
    pronouns: string | null;
    content: string;
  }): ResolvedPersona {
    return {
      personaId: persona.id,
      personaName: persona.name,
      preferredName: persona.preferredName,
      pronouns: persona.pronouns,
      content: persona.content,
    };
  }

  /**
   * Get system default (empty persona)
   */
  protected getSystemDefault(): ResolvedPersona {
    return SYSTEM_DEFAULT_PERSONA;
  }

  /**
   * Get persona content formatted for prompt injection (legacy - flattened string)
   *
   * @deprecated Use getPersonaForPrompt for structured data
   *
   * Accepts either a UUID personaId or a 'discord:XXXX' format ID.
   * For discord: format, returns null (caller should resolve to UUID first).
   */
  async getPersonaContentForPrompt(personaId: string): Promise<string | null> {
    const data = await this.getPersonaForPrompt(personaId);
    if (data === null) {
      return null;
    }

    // Build persona context with structured fields (legacy format)
    const parts: string[] = [];

    if (data.preferredName !== null && data.preferredName.length > 0) {
      parts.push(`Name: ${data.preferredName}`);
    }

    if (data.pronouns !== null && data.pronouns.length > 0) {
      parts.push(`Pronouns: ${data.pronouns}`);
    }

    if (data.content.length > 0) {
      parts.push(data.content);
    }

    return parts.length > 0 ? parts.join('\n') : null;
  }

  /**
   * Get structured persona data for prompt inclusion
   *
   * Returns separate fields for preferredName, pronouns, and content,
   * allowing callers to format them as proper XML elements.
   *
   * Accepts either a UUID personaId or a 'discord:XXXX' format ID.
   * For discord: format, returns null (caller should resolve to UUID first).
   */
  async getPersonaForPrompt(personaId: string): Promise<PersonaPromptData | null> {
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

      return {
        preferredName: persona.preferredName,
        pronouns: persona.pronouns,
        content: persona.content ?? '',
      };
    } catch (error) {
      logger.error({ err: error, personaId }, 'Failed to get persona data');
      return null;
    }
  }

  /**
   * Validate a personaId is a UUID, returning it unchanged or null.
   *
   * **Post-Phase-4 contract**: callers must pass UUID personaIds. The
   * legacy `discord:XXXX` placeholder format is stripped at the bot-client
   * boundary by `ExtendedContextPersonaResolver.resolveExtendedContextPersonaIds`
   * before any data leaves the service, so ai-worker never sees it.
   *
   * This method remains as a defensive checkpoint: if it ever receives a
   * non-UUID input, a `warn` log fires as a tripwire signaling a regression
   * (a caller somewhere is producing non-UUID personaIds that bypassed the
   * resolution pass). The personaId parameter stays in the log for triage.
   *
   * The empty-string sentinel (used by `ExtendedContextPersonaResolver`'s
   * strip pass to mark unresolved message authors) also returns null — it's
   * not a UUID, but it's the documented "no persona" value and shouldn't
   * warn. Callers handling extended-context messages should check for empty
   * string before calling this.
   *
   * @param personaId - A UUID persona ID
   * @param _personalityId - Kept for signature stability with existing callers
   * @returns The UUID if valid, null otherwise
   */
  resolveToUuid(personaId: string, _personalityId: string): Promise<string | null> {
    if (UUID_REGEX.test(personaId)) {
      return Promise.resolve(personaId);
    }
    if (personaId !== '') {
      logger.warn(
        { personaId },
        'Non-UUID personaId passed to resolveToUuid — check extended-context strip pass'
      );
    }
    return Promise.resolve(null);
  }
}
