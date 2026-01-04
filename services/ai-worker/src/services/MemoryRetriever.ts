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
} from '@tzurot/common-types';
import type {
  MemoryDocument,
  ConversationContext,
  ParticipantInfo,
} from './ConversationalRAGService.js';
import { PersonaResolver } from './resolvers/index.js';

const logger = createLogger('MemoryRetriever');

export class MemoryRetriever {
  private memoryManager?: PgvectorMemoryAdapter;
  private personaResolver: PersonaResolver;

  constructor(memoryManager?: PgvectorMemoryAdapter, personaResolver?: PersonaResolver) {
    this.memoryManager = memoryManager;
    // Create default PersonaResolver if not provided (for backwards compatibility)
    this.personaResolver = personaResolver ?? new PersonaResolver(getPrismaClient());
  }

  /**
   * Retrieve and log relevant memories from vector store
   */
  async retrieveRelevantMemories(
    personality: LoadedPersonality,
    userMessage: string,
    context: ConversationContext
  ): Promise<MemoryDocument[]> {
    // Calculate cutoff timestamp with buffer to prevent STM/LTM overlap
    // If conversation history exists, exclude memories within buffer window of oldest message
    let excludeNewerThan: number | undefined = context.oldestHistoryTimestamp;

    if (excludeNewerThan !== undefined) {
      // Apply time buffer to ensure no overlap
      // If oldest STM message is at timestamp T, exclude LTM memories after (T - buffer)
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
      // IMPORTANT: No deduplication! All memories will be returned regardless of recency.
      // This can cause verbatim repetition if recent responses are stored in LTM.
      logger.warn(
        {
          hasConversationHistory: context.conversationHistory !== undefined,
          historyMessageCount: context.conversationHistory?.length ?? 0,
        },
        '[MemoryRetriever] WARNING: No oldestHistoryTimestamp - STM/LTM deduplication DISABLED. ' +
          'Recent memories may duplicate conversation history content.'
      );
    }

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
      return [];
    }

    const { personaId, shareLtmAcrossPersonalities } = personaResult;

    const memoryQueryOptions: MemoryQueryOptions = {
      personaId, // Required: which persona's memories to search
      // Only filter by personality if user hasn't enabled cross-personality LTM sharing
      personalityId: shareLtmAcrossPersonalities ? undefined : personality.id,
      sessionId: context.sessionId,
      limit:
        personality.memoryLimit !== undefined && personality.memoryLimit > 0
          ? personality.memoryLimit
          : AI_DEFAULTS.MEMORY_LIMIT,
      scoreThreshold:
        personality.memoryScoreThreshold !== undefined && personality.memoryScoreThreshold > 0
          ? personality.memoryScoreThreshold
          : AI_DEFAULTS.MEMORY_SCORE_THRESHOLD,
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
    // Use waterfall method when channels are specified for additive retrieval
    const relevantMemories =
      this.memoryManager !== undefined
        ? memoryQueryOptions.channelIds !== undefined && memoryQueryOptions.channelIds.length > 0
          ? await this.memoryManager.queryMemoriesWithChannelScoping(
              userMessage,
              memoryQueryOptions
            )
          : await this.memoryManager.queryMemories(userMessage, memoryQueryOptions)
        : [];

    if (relevantMemories.length > 0) {
      logger.info(
        `[MemoryRetriever] Retrieved ${relevantMemories.length} relevant memories for ${personality.name}`
      );

      // Log each memory with ID, score, timestamp, and truncated content
      relevantMemories.forEach((doc, idx) => {
        const id = typeof doc.metadata?.id === 'string' ? doc.metadata.id : 'unknown';
        const score = typeof doc.metadata?.score === 'number' ? doc.metadata.score : 0;
        const createdAt = doc.metadata?.createdAt as string | number | undefined;
        const timestamp =
          createdAt !== undefined && createdAt !== null ? formatMemoryTimestamp(createdAt) : null;
        const content = doc.pageContent.substring(0, 120);
        const truncated = doc.pageContent.length > 120 ? '...' : '';

        logger.info(
          `[MemoryRetriever] Memory ${idx + 1}: id=${id} score=${score.toFixed(3)} date=${timestamp ?? 'unknown'} content="${content}${truncated}"`
        );
      });
    } else {
      logger.debug(
        `[MemoryRetriever] No memory retrieval (${this.memoryManager !== undefined ? 'no memories found' : 'memory disabled'})`
      );
    }

    return relevantMemories;
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
   */
  async getAllParticipantPersonas(
    context: ConversationContext
  ): Promise<Map<string, ParticipantInfo>> {
    const personaMap = new Map<string, ParticipantInfo>();

    if (!context.participants || context.participants.length === 0) {
      logger.debug(`[MemoryRetriever] No participants provided in context`);
      return personaMap;
    }

    logger.debug(
      `[MemoryRetriever] Fetching content for ${context.participants.length} participant(s)`
    );

    // Fetch content for each participant
    for (const participant of context.participants) {
      const content = await this.getPersonaContent(participant.personaId);
      if (content !== null && content.length > 0) {
        // Include guild info:
        // - For active speaker: use activePersonaGuildInfo (from triggering message)
        // - For other participants: look up in participantGuildInfo (from extended context)
        let guildInfo;
        if (participant.isActive) {
          guildInfo = context.activePersonaGuildInfo;
        } else if (context.participantGuildInfo) {
          guildInfo = context.participantGuildInfo[participant.personaId];
        }

        personaMap.set(participant.personaName, {
          content,
          isActive: participant.isActive,
          personaId: participant.personaId,
          guildInfo,
        });

        logger.debug(
          `[MemoryRetriever] Loaded persona ${participant.personaName} (${participant.personaId.substring(0, 8)}...): ${content.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW)}...`
        );
      } else {
        logger.warn(
          {},
          `[MemoryRetriever] No content found for participant ${participant.personaName} (${participant.personaId})`
        );
      }
    }

    return personaMap;
  }

  /**
   * Get persona content by personaId
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
   * @returns Object with personaId and shareLtmAcrossPersonalities flag, or null if not found
   */
  async resolvePersonaForMemory(
    discordUserId: string,
    personalityId: string
  ): Promise<{ personaId: string; shareLtmAcrossPersonalities: boolean } | null> {
    return this.personaResolver.resolveForMemory(discordUserId, personalityId);
  }
}
