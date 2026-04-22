/**
 * Memory Retriever
 *
 * Handles long-term memory queries, persona lookups, and memory deduplication logic.
 * Extracted from ConversationalRAGService for better modularity and testability.
 *
 * Uses PersonaResolver for consistent persona resolution with caching and auto-defaulting.
 */

import { PgvectorMemoryAdapter, MemoryQueryOptions } from './PgvectorMemoryAdapter.js';
import {
  createLogger,
  getPrismaClient,
  AI_DEFAULTS,
  TEXT_LIMITS,
  formatMemoryTimestamp,
  type LoadedPersonality,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types';
import type {
  MemoryDocument,
  ConversationContext,
  ParticipantInfo,
} from './ConversationalRAGTypes.js';
import { PersonaResolver, type PersonaPromptData } from './resolvers/index.js';

const logger = createLogger('MemoryRetriever');

/**
 * Result of memory retrieval including metadata
 */
interface MemoryRetrievalResult {
  memories: MemoryDocument[];
  focusModeEnabled: boolean;
}

export class MemoryRetriever {
  private memoryManager?: PgvectorMemoryAdapter;
  private personaResolver: PersonaResolver;

  constructor(memoryManager?: PgvectorMemoryAdapter, personaResolver?: PersonaResolver) {
    this.memoryManager = memoryManager;
    // Create default PersonaResolver if not provided (for backwards compatibility)
    this.personaResolver = personaResolver ?? new PersonaResolver(getPrismaClient());
  }

  /**
   * Calculate STM/LTM deduplication cutoff timestamp
   * Applies buffer to prevent overlap between short-term and long-term memories
   */
  private calculateDeduplicationCutoff(context: ConversationContext): number | undefined {
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
   * @param configOverrides - When provided, cascade-resolved values override personality defaults
   *   for memoryLimit, memoryScoreThreshold, and focusModeEnabled.
   */
  // eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- Guard clauses for weigh-in/focus/no-persona early exits add branches but keep the flow flat
  async retrieveRelevantMemories(
    personality: LoadedPersonality,
    userMessage: string,
    context: ConversationContext,
    configOverrides?: ResolvedConfigOverrides
  ): Promise<MemoryRetrievalResult> {
    // Weigh-in mode: anonymous poke — skip LTM retrieval entirely (no past memories injected)
    if (context.isWeighIn === true) {
      logger.info(
        { userId: context.userId, personalityId: personality.id },
        'Weigh-in mode - skipping LTM retrieval'
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

    // Determine memory retrieval params: cascade overrides > personality values > AI defaults
    const effectiveMemoryLimit =
      configOverrides?.memoryLimit ??
      (personality.memoryLimit !== undefined && personality.memoryLimit > 0
        ? personality.memoryLimit
        : AI_DEFAULTS.MEMORY_LIMIT);
    const effectiveScoreThreshold =
      configOverrides?.memoryScoreThreshold ??
      (personality.memoryScoreThreshold !== undefined && personality.memoryScoreThreshold > 0
        ? personality.memoryScoreThreshold
        : AI_DEFAULTS.MEMORY_SCORE_THRESHOLD);

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

    // Query memories only if memory manager is available
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

    return { memories: relevantMemories, focusModeEnabled: false };
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
   * Post-Phase-4 contract: `participant.personaId` is always either a valid
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
      // Post-Phase-4 contract: personaId is always a UUID (from DB history
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
      // Keys in participantGuildInfo are UUIDs post-Phase-4 (remapped by
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
