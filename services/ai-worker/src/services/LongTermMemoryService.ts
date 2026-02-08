/**
 * Long-Term Memory Service
 *
 * Handles storage of interactions to pgvector (long-term memory).
 * Extracted from ConversationalRAGService for better modularity and testability.
 *
 * Note: conversation_history records are created by bot-client after Discord send succeeds.
 * This service only handles LTM (pgvector) storage.
 */

import { PgvectorMemoryAdapter } from './PgvectorMemoryAdapter.js';
import {
  createLogger,
  getPrismaClient,
  type LoadedPersonality,
  generatePendingMemoryUuid,
} from '@tzurot/common-types';
import type { ConversationContext } from './ConversationalRAGTypes.js';

const logger = createLogger('LongTermMemoryService');

export class LongTermMemoryService {
  private memoryManager?: PgvectorMemoryAdapter;

  constructor(memoryManager?: PgvectorMemoryAdapter) {
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
    const prisma = getPrismaClient();
    let pendingMemoryId: string | null = null;

    try {
      if (this.memoryManager === undefined) {
        logger.debug(`[LTM] Memory storage disabled - interaction not stored in vector database`);
        return;
      }

      // Determine canon scope and prepare memory metadata
      const canonScope: 'global' | 'personal' | 'session' =
        context.sessionId !== undefined && context.sessionId.length > 0 ? 'session' : 'personal';
      // Use {user} and {assistant} tokens - actual names injected at retrieval time
      const interactionText = `{user}: ${userMessage}\n{assistant}: ${aiResponse}`;

      const memoryMetadata = {
        personaId,
        personalityId: personality.id,
        sessionId: context.sessionId,
        canonScope,
        createdAt: Date.now(), // Current timestamp in milliseconds for LTM
        summaryType: 'conversation',
        contextType:
          context.channelId !== undefined && context.channelId.length > 0 ? 'channel' : 'dm',
        channelId: context.channelId,
        guildId: context.serverId,
        serverId: context.serverId,
      };

      // Create pending_memory record (safety net for vector storage)
      // Note: conversationHistoryId is optional (bot-client can backfill if needed)
      const pendingMemory = await prisma.pendingMemory.create({
        data: {
          id: generatePendingMemoryUuid(personaId, personality.id, interactionText),
          personaId,
          personalityId: personality.id,
          text: interactionText,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          metadata: memoryMetadata as any, // Cast to any for Prisma Json type
          attempts: 0,
        },
      });
      pendingMemoryId = pendingMemory.id;
      logger.debug(`[LTM] Created pending_memory (${pendingMemoryId})`);

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
        `[LTM] Stored interaction to LTM in ${canonScope} canon for ${personality.name} (persona: ${personaId})`
      );
    } catch (error) {
      logger.error({ err: error }, '[LTM] Failed to store interaction to vector database');

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
          logger.info(
            `[LTM] Updated pending_memory (${pendingMemoryId}) with error - will retry later`
          );
        } catch (updateError) {
          logger.error({ err: updateError }, `[LTM] Failed to update pending_memory`);
        }
      }

      // Don't throw - this is a non-critical error
    }
  }
}
