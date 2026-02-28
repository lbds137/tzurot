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
        '[MemoryRetriever] STM/LTM deduplication active - excluding memories newer than cutoff'
      );
    } else {
      logger.warn(
        {
          hasConversationHistory: context.conversationHistory !== undefined,
          historyMessageCount: context.conversationHistory?.length ?? 0,
        },
        '[MemoryRetriever] WARNING: No oldestHistoryTimestamp - STM/LTM deduplication DISABLED. ' +
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
        `[MemoryRetriever] No memory retrieval (${this.memoryManager !== undefined ? 'no memories found' : 'memory disabled'})`
      );
      return;
    }

    logger.info(
      `[MemoryRetriever] Retrieved ${memories.length} relevant memories for ${personalityName}`
    );

    memories.forEach((doc, idx) => {
      const id = typeof doc.metadata?.id === 'string' ? doc.metadata.id : 'unknown';
      const score = typeof doc.metadata?.score === 'number' ? doc.metadata.score : 0;
      const createdAt = doc.metadata?.createdAt;
      const timestamp =
        createdAt !== undefined && createdAt !== null ? formatMemoryTimestamp(createdAt) : null;
      const content = doc.pageContent.substring(0, 120);
      const truncated = doc.pageContent.length > 120 ? '...' : '';

      logger.info(
        `[MemoryRetriever] Memory ${idx + 1}: id=${id} score=${score.toFixed(3)} date=${timestamp ?? 'unknown'} content="${content}${truncated}"`
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
        '[MemoryRetriever] Weigh-in mode - skipping LTM retrieval'
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
        {},
        `[MemoryRetriever] No persona found for user ${context.userId} with personality ${personality.name}, skipping memory retrieval`
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
        '[MemoryRetriever] Using channel-scoped memory retrieval'
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
   * Handles both UUID personaIds (from DB history) and 'discord:XXXX' format
   * (from extended context). Discord format IDs are resolved to actual persona
   * UUIDs if the user is registered.
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
      logger.debug(`[MemoryRetriever] No participants provided in context`);
      return personaMap;
    }

    logger.debug(
      `[MemoryRetriever] Fetching content for ${context.participants.length} participant(s)`
    );

    // Track resolved personaIds to deduplicate participants
    // Same user may appear with different names (persona name vs Discord display name)
    // e.g., "Lila" from DB history vs "Lila Shabbat Nachiel" from extended context
    const resolvedIdToName = new Map<string, string>();

    // Fetch content for each participant
    for (const participant of context.participants) {
      // Resolve personaId - handles both UUID and 'discord:XXXX' formats
      // Extended context uses 'discord:XXXX', DB history uses UUIDs
      const resolvedPersonaId = await this.personaResolver.resolveToUuid(
        participant.personaId,
        personalityId
      );

      // If we couldn't resolve to a UUID, user is not registered (transient participant)
      if (resolvedPersonaId === null) {
        logger.debug(
          { personaId: participant.personaId, personaName: participant.personaName },
          `[MemoryRetriever] Could not resolve personaId - user may not be registered`
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
            `[MemoryRetriever] Skipping duplicate participant - active speaker takes precedence`
          );
          continue;
        }

        // Prefer shorter name (persona name "Lila" vs Discord display name "Lila Shabbat Nachiel")
        // This heuristic works because persona names are typically short
        if (existingName.length <= participant.personaName.length && !participant.isActive) {
          logger.debug(
            { resolvedPersonaId, skippedName: participant.personaName, keptName: existingName },
            `[MemoryRetriever] Skipping duplicate participant - preferring shorter name`
          );
          continue;
        }

        // New entry is better - remove old entry
        personaMap.delete(existingName);
        logger.debug(
          { resolvedPersonaId, removedName: existingName, newName: participant.personaName },
          `[MemoryRetriever] Replacing duplicate participant with better name`
        );
      }

      const personaData = await this.getPersonaData(resolvedPersonaId);
      if (personaData !== null && personaData.content.length > 0) {
        // Include guild info:
        // - For active speaker: use activePersonaGuildInfo (from triggering message)
        // - For other participants: look up in participantGuildInfo (from extended context)
        // Note: participantGuildInfo is keyed by original personaId (may be discord: format)
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
          `[MemoryRetriever] Loaded persona ${participant.personaName} (${resolvedPersonaId.substring(0, 8)}...): ${personaData.content.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW)}...`
        );
      } else {
        logger.warn(
          {},
          `[MemoryRetriever] No content found for participant ${participant.personaName} (${resolvedPersonaId})`
        );
      }
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
