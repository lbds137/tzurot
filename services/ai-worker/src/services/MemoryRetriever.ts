/**
 * Memory Retriever
 *
 * Handles long-term memory queries, persona lookups, and memory deduplication logic.
 * Extracted from ConversationalRAGService for better modularity and testability.
 *
 * Uses PersonaResolver for consistent persona resolution with caching and auto-defaulting.
 */

import { type PgvectorMemoryAdapter, type MemoryQueryOptions } from './PgvectorMemoryAdapter.js';
import { AI_DEFAULTS } from '@tzurot/common-types/constants/ai';
import { TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import { type ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { formatMemoryTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type {
  MemoryDocument,
  ConversationContext,
  ParticipantInfo,
} from './ConversationalRAGTypes.js';
import { PersonaResolver, type PersonaPromptData } from '@tzurot/identity';

const logger = createLogger('MemoryRetriever');

/**
 * Result of memory retrieval including metadata
 */
export interface MemoryRetrievalResult {
  memories: MemoryDocument[];
  focusModeEnabled: boolean;
  /**
   * The resolved persona for this turn — present ONLY when LTM retrieval
   * actually ran. Undefined when retrieval was skipped (incognito, focus mode,
   * or no persona), so the fact-retrieval path (Phase 2 slice 4a) inherits the
   * exact same scope AND the same skip decisions from one source of truth.
   */
  personaId?: string;
}

export class MemoryRetriever {
  private memoryManager?: PgvectorMemoryAdapter;
  private personaResolver: PersonaResolver;

  constructor(
    prisma: PrismaClient,
    memoryManager?: PgvectorMemoryAdapter,
    personaResolver?: PersonaResolver
  ) {
    this.memoryManager = memoryManager;
    // Create default PersonaResolver if not provided (for backwards compatibility)
    this.personaResolver = personaResolver ?? new PersonaResolver(prisma);
  }

  /**
   * Calculate STM/LTM deduplication cutoff timestamp.
   *
   * Exact mode (history pre-pass ran — `stmLtmCutoffInputs` present): the
   * current-channel bound is the oldest SHIPPED message PLUS the buffer —
   * over-retrieving past the boundary so memories of DROPPED messages (whose
   * persistence lags their source) stay reachable; the selection-time ID
   * filter is the authoritative dedup, so over-retrieval cannot duplicate.
   * Refs/cross-channel keep the pessimistic minus-buffer bound (no shipped-id
   * plumbing for them). Nothing shipped and no refs → no cutoff: LTM covers
   * the whole range (the everything-truncated case).
   *
   * Legacy mode (no pre-pass — non-pipeline callers): pessimistic
   * oldest-FETCHED minus buffer, as before.
   */
  private calculateDeduplicationCutoff(context: ConversationContext): number | undefined {
    if (context.stmLtmCutoffInputs !== undefined) {
      const { oldestSelectedTs } = context.stmLtmCutoffInputs;
      const bounds: number[] = [];
      if (oldestSelectedTs !== undefined) {
        bounds.push(oldestSelectedTs + AI_DEFAULTS.STM_LTM_BUFFER_MS);
      }
      if (context.nonHistoryOldestTimestamp !== undefined) {
        bounds.push(context.nonHistoryOldestTimestamp - AI_DEFAULTS.STM_LTM_BUFFER_MS);
      }
      const cutoff = bounds.length > 0 ? Math.min(...bounds) : undefined;
      logger.info(
        {
          oldestSelectedTs:
            oldestSelectedTs !== undefined ? formatMemoryTimestamp(oldestSelectedTs) : undefined,
          nonHistoryOldestTimestamp:
            context.nonHistoryOldestTimestamp !== undefined
              ? formatMemoryTimestamp(context.nonHistoryOldestTimestamp)
              : undefined,
          excludeNewerThan: cutoff !== undefined ? formatMemoryTimestamp(cutoff) : 'none',
        },
        'STM/LTM dedup cutoff (exact mode — shipped-history boundary)'
      );
      return cutoff;
    }

    let excludeNewerThan: number | undefined = context.oldestHistoryTimestamp;

    if (excludeNewerThan !== undefined) {
      const originalTimestamp = excludeNewerThan;
      excludeNewerThan = excludeNewerThan - AI_DEFAULTS.STM_LTM_BUFFER_MS;

      logger.info(
        {
          oldestHistoryTimestamp: formatMemoryTimestamp(originalTimestamp),
          excludeNewerThan: formatMemoryTimestamp(excludeNewerThan),
          bufferMs: AI_DEFAULTS.STM_LTM_BUFFER_MS,
          historyMessageCount: context.conversationHistory?.length ?? 0,
        },
        'STM/LTM deduplication active - excluding memories newer than cutoff'
      );
    } else {
      logger.warn(
        {
          hasConversationHistory: context.conversationHistory !== undefined,
          historyMessageCount: context.conversationHistory?.length ?? 0,
        },
        'WARNING: No oldestHistoryTimestamp - STM/LTM deduplication DISABLED. ' +
          'Recent memories may duplicate conversation history content.'
      );
    }

    return excludeNewerThan;
  }

  /**
   * Log retrieved memories with ID, score, timestamp, and truncated content
   */
  private logRetrievedMemories(memories: MemoryDocument[], personalityName: string): void {
    if (memories.length === 0) {
      logger.debug(
        { reason: this.memoryManager !== undefined ? 'no memories found' : 'memory disabled' },
        'No memory retrieval'
      );
      return;
    }

    logger.info({ count: memories.length, personalityName }, 'Retrieved relevant memories');

    memories.forEach((doc, idx) => {
      const id = typeof doc.metadata?.id === 'string' ? doc.metadata.id : 'unknown';
      const score = typeof doc.metadata?.score === 'number' ? doc.metadata.score : 0;
      const createdAt = doc.metadata?.createdAt;
      const timestamp =
        createdAt !== undefined && createdAt !== null ? formatMemoryTimestamp(createdAt) : null;
      const content = doc.pageContent.substring(0, 120);
      const truncated = doc.pageContent.length > 120 ? '...' : '';

      logger.info(
        {
          memoryIndex: idx + 1,
          memoryId: id,
          score: Number(score.toFixed(3)),
          timestamp: timestamp ?? 'unknown',
          contentPreview: `${content}${truncated}`,
        },
        'Memory retrieved'
      );
    });
  }

  /**
   * Retrieve and log relevant memories from vector store
   *
   * @param configOverrides - Cascade-resolved values for memoryLimit,
   *   memoryScoreThreshold, and focusModeEnabled. These come from the config
   *   cascade (with AI_DEFAULTS as the fallback), NOT the retired LlmConfig
   *   columns.
   */
  async retrieveRelevantMemories(
    personality: LoadedPersonality,
    userMessage: string,
    context: ConversationContext,
    configOverrides?: ResolvedConfigOverrides
  ): Promise<MemoryRetrievalResult> {
    // Incognito (anonymous chime-in/random) — skip LTM retrieval entirely (no
    // past memories injected). The personal-vs-incognito decision was resolved
    // once in buildConversationContext; absent (test contexts) reads as personal,
    // so a personal summon reads memories.
    if (context.summonAnonymity?.kind === 'incognito') {
      logger.info(
        { userId: context.userId, personalityId: personality.id },
        'Incognito mode - skipping LTM retrieval'
      );
      return { memories: [], focusModeEnabled: false };
    }

    const excludeNewerThan = this.calculateDeduplicationCutoff(context);

    // Resolve user's personaId for this personality using PersonaResolver
    const personaResult = await this.personaResolver.resolveForMemory(
      context.userId,
      personality.id
    );

    if (personaResult === null) {
      logger.warn(
        { userId: context.userId, personalityName: personality.name },
        'No persona found, skipping memory retrieval'
      );
      return { memories: [], focusModeEnabled: false };
    }

    const { personaId } = personaResult;

    // Read shareLtmAcrossPersonalities from cascade (fully resolved, always boolean).
    // configOverrides is always provided when cascade is active; fallback for legacy/test callers.
    const shareLtmAcrossPersonalities = configOverrides?.shareLtmAcrossPersonalities ?? false;

    // Determine focusModeEnabled: cascade overrides > DB column (from persona resolver)
    const focusModeEnabled = configOverrides?.focusModeEnabled ?? personaResult.focusModeEnabled;

    // Check if focus mode is enabled - skip retrieval but continue saving memories
    if (focusModeEnabled) {
      logger.info(
        {
          userId: context.userId,
          personalityId: personality.id,
          personalityName: personality.name,
          source: configOverrides !== undefined ? 'cascade' : 'db-column',
        },
        '[MemoryRetriever] Focus mode enabled - skipping LTM retrieval (memories still being saved)'
      );
      return { memories: [], focusModeEnabled: true };
    }

    // Memory retrieval params come from the config cascade, which resolves from
    // a hardcoded 0.5/20 baseline (HARDCODED_CONFIG_DEFAULTS) so a value is
    // ALWAYS present whenever the cascade is active — i.e. every production
    // request. AI_DEFAULTS (the same 0.5/20) is the fallback only for
    // cascade-inactive callers (tests/legacy). The old per-LlmConfig-column
    // tier was dead in prod (tier 1 always won) and has been removed.
    const effectiveMemoryLimit = configOverrides?.memoryLimit ?? AI_DEFAULTS.MEMORY_LIMIT;
    const effectiveScoreThreshold =
      configOverrides?.memoryScoreThreshold ?? AI_DEFAULTS.MEMORY_SCORE_THRESHOLD;

    const memoryQueryOptions: MemoryQueryOptions = {
      personaId,
      personalityId: shareLtmAcrossPersonalities ? undefined : personality.id,
      sessionId: context.sessionId,
      limit: effectiveMemoryLimit,
      scoreThreshold: effectiveScoreThreshold,
      excludeNewerThan,
    };

    // Add channel IDs for scoped retrieval if user referenced channels
    if (context.referencedChannels && context.referencedChannels.length > 0) {
      memoryQueryOptions.channelIds = context.referencedChannels.map(c => c.channelId);
      logger.debug(
        {
          channelCount: memoryQueryOptions.channelIds.length,
          channelIds: memoryQueryOptions.channelIds,
        },
        'Using channel-scoped memory retrieval'
      );
    }

    // Query memories only if memory manager is available.
    //
    // Storage→RAG boundary: `queryMemories*` returns `PgvectorMemoryDocument[]`
    // (wider `metadata?: Record<string, unknown>`), assigned here into the
    // RAG-layer `MemoryDocument[]` shape (narrower typed metadata). The two
    // are structurally compatible because all RAG-layer metadata fields are
    // optional — see `PgvectorTypes.ts` for the change-together invariant.
    const relevantMemories =
      this.memoryManager !== undefined
        ? memoryQueryOptions.channelIds !== undefined && memoryQueryOptions.channelIds.length > 0
          ? await this.memoryManager.queryMemoriesWithChannelScoping(
              userMessage,
              memoryQueryOptions
            )
          : await this.memoryManager.queryMemories(userMessage, memoryQueryOptions)
        : [];

    this.logRetrievedMemories(relevantMemories, personality.name);

    return { memories: relevantMemories, focusModeEnabled: false, personaId };
  }

  /**
   * Get ALL participant personas from conversation
   * Returns a Map of personaName -> ParticipantInfo for all users in the conversation
   *
   * The map includes:
   * - content: User's persona description
   * - isActive: Whether this is the current speaker
   * - personaId: UUID for ID binding in chat_log
   * - guildInfo: Optional guild-specific info (roles, color, join date)
   *   - Active speaker: from activePersonaGuildInfo
   *   - Other participants: from participantGuildInfo (when extended context is enabled)
   *
   * Contract: `participant.personaId` is always either a valid
   * UUID (DB history or resolved extended context) or the empty-string
   * sentinel (unresolvable extended-context participant). The legacy
   * `discord:XXXX` placeholder format is stripped by bot-client's
   * `ExtendedContextPersonaResolver.resolveExtendedContextPersonaIds` before
   * the job crosses the service boundary — ai-worker never sees it.
   *
   * @param context - Conversation context with participants
   * @param personalityId - Personality ID for resolving per-personality persona overrides
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Resolves participant personas via per-personality overrides → user defaults → display name fallback for each participant
  async getAllParticipantPersonas(
    context: ConversationContext,
    personalityId: string
  ): Promise<Map<string, ParticipantInfo>> {
    const personaMap = new Map<string, ParticipantInfo>();

    if (!context.participants || context.participants.length === 0) {
      logger.debug('No participants provided in context');
      return personaMap;
    }

    logger.debug({ count: context.participants.length }, 'Fetching participant content');

    // Track resolved personaIds to deduplicate participants
    // Same user may appear with different names (persona name vs Discord display name)
    // e.g., "Lila" from DB history vs "Lila Shabbat Nachiel" from extended context
    const resolvedIdToName = new Map<string, string>();

    // Fetch content for each participant
    for (const participant of context.participants) {
      // Contract: personaId is always a UUID (from DB history
      // or resolved extended context) OR the empty string sentinel (for
      // extended-context messages whose author couldn't be resolved to a
      // registered persona). resolveToUuid is now a UUID-or-null guard —
      // all cross-service identity resolution already happened upstream in
      // bot-client's `ExtendedContextPersonaResolver.resolveExtendedContextPersonaIds`.
      const resolvedPersonaId = await this.personaResolver.resolveToUuid(
        participant.personaId,
        personalityId
      );

      // Non-UUID personaId (including the '' sentinel) means we can't
      // include this participant's persona content in the prompt. The
      // message text itself stays in context with display-name attribution —
      // we just don't inject persona content for this participant.
      if (resolvedPersonaId === null) {
        logger.debug(
          { personaId: participant.personaId, personaName: participant.personaName },
          `Participant has no resolvable persona — skipping`
        );
        continue;
      }

      // Check if we already have a participant with this resolved personaId
      // Prefer: active speaker's name > persona name (from DB) > Discord display name
      const existingName = resolvedIdToName.get(resolvedPersonaId);
      if (existingName !== undefined) {
        // Skip if existing entry is from active speaker or is shorter (likely persona name)
        // Active speaker's name is authoritative
        const existingEntry = personaMap.get(existingName);
        if (existingEntry?.isActive === true) {
          logger.debug(
            { resolvedPersonaId, skippedName: participant.personaName, keptName: existingName },
            `Skipping duplicate participant - active speaker takes precedence`
          );
          continue;
        }

        // Prefer shorter name (persona name "Lila" vs Discord display name "Lila Shabbat Nachiel")
        // This heuristic works because persona names are typically short
        if (existingName.length <= participant.personaName.length && !participant.isActive) {
          logger.debug(
            { resolvedPersonaId, skippedName: participant.personaName, keptName: existingName },
            `Skipping duplicate participant - preferring shorter name`
          );
          continue;
        }

        // New entry is better - remove old entry
        personaMap.delete(existingName);
        logger.debug(
          { resolvedPersonaId, removedName: existingName, newName: participant.personaName },
          `Replacing duplicate participant with better name`
        );
      }

      const personaData = await this.getPersonaData(resolvedPersonaId);
      if (personaData === null) {
        // Truly no persona record found — can't include without identity data.
        // Warn so missing records don't stay silent.
        logger.warn(
          { resolvedPersonaId, personaName: participant.personaName },
          `No persona record for participant — omitting from prompt`
        );
        continue;
      }

      // Note: empty content is allowed. Identity (name, pronouns, guild info)
      // is still valuable to the LLM even without a bio. Dropping an active
      // participant for empty content was the root of an incident where new
      // users whose persona had no bio text were entirely missing from the
      // <participants> section of the system prompt.
      if (personaData.content.length === 0) {
        logger.warn(
          {
            resolvedPersonaId,
            personaName: participant.personaName,
            isActive: participant.isActive,
          },
          `Persona has empty content — including with identity fields only`
        );
      }

      // Include guild info:
      // - For active speaker: use activePersonaGuildInfo (from triggering message)
      // - For other participants: look up in participantGuildInfo (from extended context)
      // Keys in participantGuildInfo are UUIDs (remapped by
      // ExtendedContextPersonaResolver alongside the persona resolution pass).
      let guildInfo;
      if (participant.isActive) {
        guildInfo = context.activePersonaGuildInfo;
      } else if (context.participantGuildInfo) {
        guildInfo = context.participantGuildInfo[participant.personaId];
      }

      personaMap.set(participant.personaName, {
        preferredName: personaData.preferredName ?? undefined,
        pronouns: personaData.pronouns ?? undefined,
        content: personaData.content,
        isActive: participant.isActive,
        personaId: resolvedPersonaId, // Use resolved UUID for ID binding
        guildInfo,
      });
      resolvedIdToName.set(resolvedPersonaId, participant.personaName);

      logger.debug(
        {
          personaName: participant.personaName,
          resolvedPersonaId,
          contentPreview: personaData.content.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW),
        },
        'Loaded persona'
      );
    }

    return personaMap;
  }

  /**
   * Get structured persona data by personaId
   * Delegates to PersonaResolver for consistent data lookup
   */
  async getPersonaData(personaId: string): Promise<PersonaPromptData | null> {
    return this.personaResolver.getPersonaForPrompt(personaId);
  }

  /**
   * Get persona content by personaId (legacy - flattened string)
   * @deprecated Use getPersonaData for structured data
   * Delegates to PersonaResolver for consistent content formatting
   */
  async getPersonaContent(personaId: string): Promise<string | null> {
    return this.personaResolver.getPersonaContentForPrompt(personaId);
  }

  /**
   * Resolve user's persona for memory operations (LTM storage/retrieval)
   * Exposes PersonaResolver's resolution for external callers.
   *
   * @param discordUserId - The user's Discord ID (snowflake)
   * @param personalityId - The personality UUID
   * @returns Object with personaId and focusModeEnabled flag, or null if not found
   */
  async resolvePersonaForMemory(
    discordUserId: string,
    personalityId: string
  ): Promise<{ personaId: string; focusModeEnabled: boolean } | null> {
    return this.personaResolver.resolveForMemory(discordUserId, personalityId);
  }
}
