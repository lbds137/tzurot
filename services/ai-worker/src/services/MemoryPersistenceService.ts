/**
 * Memory Persistence Service
 *
 * Handles writing conversation interactions to long-term memory:
 * - Embedding content construction
 * - Immediate memory storage
 * - Deferred memory storage (for retry scenarios)
 */

import { createLogger, type LoadedPersonality } from '@tzurot/common-types';
import type { LongTermMemoryService } from './LongTermMemoryService.js';
import type { MemoryRetriever } from './MemoryRetriever.js';
import type { ConversationContext, DeferredMemoryData } from './ConversationalRAGTypes.js';

const logger = createLogger('MemoryPersistenceService');

/**
 * Handles persistence of conversation interactions to long-term memory
 */
export class MemoryPersistenceService {
  constructor(
    private longTermMemory: LongTermMemoryService,
    private memoryRetriever: MemoryRetriever
  ) {}

  /**
   * Build content for embedding with optional referenced messages.
   * Appends referenced content to improve memory retrieval relevance.
   */
  buildContentForEmbedding(
    contentForStorage: string,
    referencedMessagesTextForSearch: string | undefined
  ): string {
    if (
      referencedMessagesTextForSearch !== undefined &&
      referencedMessagesTextForSearch.length > 0
    ) {
      return `${contentForStorage}\n\n[Referenced content: ${referencedMessagesTextForSearch}]`;
    }
    return contentForStorage;
  }

  /**
   * Store interaction to long-term memory.
   * Note: Caller should check incognito mode before calling this method.
   */
  async storeInteraction(
    personality: LoadedPersonality,
    context: ConversationContext,
    contentForStorage: string,
    responseContent: string,
    referencedMessagesTextForSearch: string | undefined
  ): Promise<void> {
    const personaResult = await this.memoryRetriever.resolvePersonaForMemory(
      context.userId,
      personality.id
    );

    if (personaResult !== null) {
      await this.longTermMemory.storeInteraction(
        personality,
        this.buildContentForEmbedding(contentForStorage, referencedMessagesTextForSearch),
        responseContent,
        context,
        personaResult.personaId
      );
    } else {
      logger.warn(
        {},
        `[MemoryPersistence] No persona found for user ${context.userId}, skipping LTM storage`
      );
    }
  }

  /**
   * Build deferred memory data for later storage.
   * Used when memory storage is deferred (e.g., for duplicate detection retries).
   */
  async buildDeferredMemoryData(
    context: ConversationContext,
    personalityId: string,
    contentForStorage: string,
    responseContent: string,
    referencedMessagesTextForSearch: string | undefined
  ): Promise<DeferredMemoryData | null> {
    const personaResult = await this.memoryRetriever.resolvePersonaForMemory(
      context.userId,
      personalityId
    );

    if (personaResult === null) {
      logger.warn(
        {},
        `[MemoryPersistence] No persona found for user ${context.userId}, cannot defer LTM`
      );
      return null;
    }

    return {
      contentForEmbedding: this.buildContentForEmbedding(
        contentForStorage,
        referencedMessagesTextForSearch
      ),
      responseContent,
      personaId: personaResult.personaId,
    };
  }

  /**
   * Store deferred memory data to long-term memory.
   *
   * Call this method after response validation passes (e.g., after duplicate
   * detection confirms the response is unique). This ensures only ONE memory
   * is stored per interaction, even when retry logic is used.
   */
  async storeDeferredMemory(
    personality: LoadedPersonality,
    context: ConversationContext,
    deferredData: DeferredMemoryData
  ): Promise<void> {
    await this.longTermMemory.storeInteraction(
      personality,
      deferredData.contentForEmbedding,
      deferredData.responseContent,
      context,
      deferredData.personaId
    );
    logger.info(
      { userId: context.userId, personalityId: personality.id, personaId: deferredData.personaId },
      '[MemoryPersistence] Stored deferred memory to LTM'
    );
  }
}
