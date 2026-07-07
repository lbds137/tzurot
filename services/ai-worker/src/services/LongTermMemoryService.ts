/**
 * Long-Term Memory Service
 *
 * Handles storage of interactions to pgvector (long-term memory).
 * Extracted from ConversationalRAGService for better modularity and testability.
 *
 * Note: conversation_history records are created by bot-client after Discord send succeeds.
 * This service only handles LTM (pgvector) storage.
 */

import { type PgvectorMemoryAdapter } from './PgvectorMemoryAdapter.js';
import { type ExtractionTrigger } from './extraction/ExtractionTrigger.js';
import type { MemoryMetadata } from './PgvectorTypes.js';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { generatePendingMemoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { deterministicMemoryUuid } from '@tzurot/common-types/constants/memory';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ConversationContext } from './ConversationalRAGTypes.js';

const logger = createLogger('LongTermMemoryService');

export class LongTermMemoryService {
  private memoryManager?: PgvectorMemoryAdapter;

  constructor(
    private readonly prisma: PrismaClient,
    memoryManager?: PgvectorMemoryAdapter,
    /** Optional fact-extraction batching tail (memory Phase 2; absent = disabled). */
    private readonly extractionTrigger?: ExtractionTrigger
  ) {
    this.memoryManager = memoryManager;
  }

  /**
   * Store an interaction to long-term memory (pgvector) only
   *
   * @param personality The personality that generated the response
   * @param userMessage User's message content (for LTM storage)
   * @param aiResponse AI's response content
   * @param context Conversation context
   * @param personaId User's persona ID (must be resolved by caller)
   */
  async storeInteraction(
    personality: LoadedPersonality,
    userMessage: string,
    aiResponse: string,
    context: ConversationContext,
    personaId: string
  ): Promise<void> {
    const { prisma } = this;
    let pendingMemoryId: string | null = null;

    try {
      if (this.memoryManager === undefined) {
        logger.debug('Memory storage disabled - interaction not stored in vector database');
        return;
      }

      // Use {user} and {assistant} tokens - actual names injected at retrieval time
      const interactionText = `{user}: ${userMessage}\n{assistant}: ${aiResponse}`;
      const memoryMetadata = buildMemoryMetadata(personality, context, personaId);

      // Create pending_memory record (safety net for vector storage)
      // Note: conversationHistoryId is optional (bot-client can backfill if needed)
      const pendingMemory = await prisma.pendingMemory.create({
        data: {
          id: generatePendingMemoryUuid(personaId, personality.id, interactionText),
          personaId,
          personalityId: personality.id,
          text: interactionText,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- Prisma Json field requires any cast
          metadata: memoryMetadata as any,
          attempts: 0,
        },
      });
      pendingMemoryId = pendingMemory.id;
      logger.debug({ pendingMemoryId }, 'Created pending_memory');

      // Try to store to vector database
      await this.memoryManager.addMemory({
        text: interactionText,
        metadata: memoryMetadata,
      });

      // Success! Delete the pending_memory
      await prisma.pendingMemory.delete({
        where: { id: pendingMemoryId },
      });
      logger.info(
        { canonScope: memoryMetadata.canonScope, personalityName: personality.name, personaId },
        'Stored interaction to LTM'
      );

      // Fire-and-forget extraction batching tail (post-commit; never blocks or
      // fails the reply pipeline — the trigger itself is throw-proof, this
      // catch is belt-and-braces for the promise chain). Known edge: chunked
      // (oversized) episodes hash with a chunk suffix, so this derived id
      // won't match their rows and they silently skip extraction — rare and
      // acceptable; the worker tolerates missing ids by design.
      if (this.extractionTrigger !== undefined && context.channelId !== undefined) {
        const episodeId = deterministicMemoryUuid(personaId, personality.id, interactionText);
        void this.extractionTrigger
          .recordEpisode(context.channelId, personality.id, episodeId)
          .catch((err: unknown) => logger.debug({ err }, 'Extraction tail rejected'));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to store interaction to vector database');

      // Update pending_memory with error details (for retry later)
      if (pendingMemoryId !== null && pendingMemoryId.length > 0) {
        try {
          await prisma.pendingMemory.update({
            where: { id: pendingMemoryId },
            data: {
              attempts: { increment: 1 },
              lastAttemptAt: new Date(),
              error: error instanceof Error ? error.message : String(error),
            },
          });
          logger.info({ pendingMemoryId }, 'Updated pending_memory with error - will retry later');
        } catch (updateError) {
          logger.error({ err: updateError }, 'Failed to update pending_memory');
        }
      }

      // Don't throw - this is a non-critical error
    }
  }
}

/**
 * Assemble the metadata for a captured interaction memory. Extracted so the
 * store path stays within complexity limits.
 */
function buildMemoryMetadata(
  personality: LoadedPersonality,
  context: ConversationContext,
  personaId: string
): MemoryMetadata {
  const canonScope: 'global' | 'personal' | 'session' =
    context.sessionId !== undefined && context.sessionId.length > 0 ? 'session' : 'personal';
  return {
    personaId,
    // Source-turn linkage (memory-architecture Phase 0, R8): the triggering
    // message id — deletion of the source turn propagates to this memory.
    messageIds:
      context.triggerMessageId !== undefined && context.triggerMessageId.length > 0
        ? [context.triggerMessageId]
        : [],
    personalityId: personality.id,
    sessionId: context.sessionId,
    canonScope,
    createdAt: Date.now(), // Current timestamp in milliseconds for LTM
    summaryType: 'conversation',
    contextType: context.channelId !== undefined && context.channelId.length > 0 ? 'channel' : 'dm',
    channelId: context.channelId,
    guildId: context.serverId,
    serverId: context.serverId,
  };
}
