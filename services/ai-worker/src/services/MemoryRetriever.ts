/**
 * Memory Retriever
 *
 * Handles long-term memory queries, persona lookups, and memory deduplication logic.
 * Extracted from ConversationalRAGService for better modularity and testability.
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
import { logAndReturnFallback } from '../utils/errorHandling.js';
import type { MemoryDocument, ConversationContext } from './ConversationalRAGService.js';

const logger = createLogger('MemoryRetriever');

export class MemoryRetriever {
  private memoryManager?: PgvectorMemoryAdapter;

  constructor(memoryManager?: PgvectorMemoryAdapter) {
    this.memoryManager = memoryManager;
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
      excludeNewerThan = excludeNewerThan - AI_DEFAULTS.STM_LTM_BUFFER_MS;

      logger.debug(
        `[MemoryRetriever] STM/LTM deduplication: excluding memories newer than ${formatMemoryTimestamp(excludeNewerThan)} ` +
          `(${AI_DEFAULTS.STM_LTM_BUFFER_MS}ms buffer applied)`
      );
    }

    // Resolve user's personaId for this personality
    const personaId = await this.getUserPersonaForPersonality(context.userId, personality.id);

    if (!personaId) {
      logger.warn(
        {},
        `[MemoryRetriever] No persona found for user ${context.userId} with personality ${personality.name}, skipping memory retrieval`
      );
      return [];
    }

    const memoryQueryOptions: MemoryQueryOptions = {
      personaId, // Required: which persona's memories to search
      personalityId: personality.id, // Optional: filter to this personality's memories
      sessionId: context.sessionId,
      limit: personality.memoryLimit || AI_DEFAULTS.MEMORY_LIMIT,
      scoreThreshold: personality.memoryScoreThreshold || AI_DEFAULTS.MEMORY_SCORE_THRESHOLD,
      excludeNewerThan,
    };

    // Query memories only if memory manager is available
    const relevantMemories =
      this.memoryManager !== undefined
        ? await this.memoryManager.queryMemories(userMessage, memoryQueryOptions)
        : [];

    if (relevantMemories.length > 0) {
      logger.info(
        `[MemoryRetriever] Retrieved ${relevantMemories.length} relevant memories for ${personality.name}`
      );

      // Log each memory with ID, score, timestamp, and truncated content
      relevantMemories.forEach((doc, idx) => {
        const id = doc.metadata?.id || 'unknown';
        const score = typeof doc.metadata?.score === 'number' ? doc.metadata.score : 0;
        const createdAt = doc.metadata?.createdAt as string | number | undefined;
        const timestamp = createdAt ? formatMemoryTimestamp(createdAt) : null;
        const content = doc.pageContent.substring(0, 120);
        const truncated = doc.pageContent.length > 120 ? '...' : '';

        logger.info(
          `[MemoryRetriever] Memory ${idx + 1}: id=${id} score=${score.toFixed(3)} date=${timestamp || 'unknown'} content="${content}${truncated}"`
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
   * Returns a Map of personaName -> persona content for all users in the conversation
   */
  async getAllParticipantPersonas(
    context: ConversationContext
  ): Promise<Map<string, { content: string; isActive: boolean }>> {
    const personaMap = new Map<string, { content: string; isActive: boolean }>();

    if (!context.participants || context.participants.length === 0) {
      logger.debug(`[MemoryRetriever] No participants provided in context`);
      return personaMap;
    }

    logger.debug(`[MemoryRetriever] Fetching content for ${context.participants.length} participant(s)`);

    // Fetch content for each participant
    for (const participant of context.participants) {
      const content = await this.getPersonaContent(participant.personaId);
      if (content) {
        personaMap.set(participant.personaName, {
          content,
          isActive: participant.isActive,
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
   * This fetches the ACTIVE persona (which might be a personality-specific override)
   */
  async getPersonaContent(personaId: string): Promise<string | null> {
    try {
      const prisma = getPrismaClient();

      const persona = await prisma.persona.findUnique({
        where: { id: personaId },
        select: {
          preferredName: true,
          pronouns: true,
          content: true,
        },
      });

      if (!persona) {return null;}

      // Build persona context with structured fields
      const parts: string[] = [];

      if (persona.preferredName) {
        parts.push(`Name: ${persona.preferredName}`);
      }

      if (persona.pronouns) {
        parts.push(`Pronouns: ${persona.pronouns}`);
      }

      if (persona.content) {
        parts.push(persona.content);
      }

      return parts.length > 0 ? parts.join('\n') : null;
    } catch (error) {
      return logAndReturnFallback(
        logger,
        `[MemoryRetriever] Failed to fetch persona ${personaId}`,
        error,
        null
      );
    }
  }

  /**
   * Get user's persona ID for a specific personality
   * Checks for personality-specific override first, then falls back to default persona
   */
  async getUserPersonaForPersonality(
    userId: string,
    personalityId: string
  ): Promise<string | null> {
    try {
      const prisma = getPrismaClient();

      // First check if user has a personality-specific persona override
      const userPersonalityConfig = await prisma.userPersonalityConfig.findFirst({
        where: {
          userId,
          personalityId,
          personaId: { not: null }, // Has a persona override
        },
        select: { personaId: true },
      });

      if (userPersonalityConfig?.personaId) {
        logger.debug(
          `[MemoryRetriever] Using personality-specific persona override for user ${userId}, personality ${personalityId}`
        );
        return userPersonalityConfig.personaId;
      }

      // Fall back to user's default persona
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          defaultPersonaLink: {
            select: { personaId: true },
          },
        },
      });

      const personaId = user?.defaultPersonaLink?.personaId || null;
      if (personaId) {
        logger.debug(`[MemoryRetriever] Using default persona for user ${userId}`);
      } else {
        logger.warn({}, `[MemoryRetriever] No persona found for user ${userId}`);
      }

      return personaId;
    } catch (error) {
      return logAndReturnFallback(
        logger,
        `[MemoryRetriever] Failed to resolve persona for user ${userId}`,
        error,
        null
      );
    }
  }
}
