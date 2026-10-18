/**
 * Memory Persistence Service
 *
 * Handles writing conversation interactions to long-term memory:
 * - Embedding content construction
 * - Immediate memory storage
 * - Deferred memory storage (for retry scenarios)
 */

import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { LongTermMemoryService } from './LongTermMemoryService.js';
import type { MemoryRetriever } from './MemoryRetriever.js';
import type { ConversationContext, DeferredMemoryData } from './ConversationalRAGTypes.js';

const logger = createLogger('MemoryPersistenceService');

export interface StoreInteractionOptions {
  personality: LoadedPersonality;
  context: ConversationContext;
  contentForStorage: string;
  responseContent: string;
  referencedMessagesTextForSearch: string | undefined;
  thinkingContent?: string;
}

export interface BuildDeferredMemoryDataOptions {
  context: ConversationContext;
  personalityId: string;
  contentForStorage: string;
  responseContent: string;
  referencedMessagesTextForSearch: string | undefined;
  thinkingContent?: string;
}

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
  async storeInteraction(options: StoreInteractionOptions): Promise<void> {
    const {
      personality,
      context,
      contentForStorage,
      responseContent,
      referencedMessagesTextForSearch,
      thinkingContent,
    } = options;
    const personaResult = await this.memoryRetriever.resolvePersonaForMemory(
      context.userId,
      personality.id
    );

    if (personaResult !== null) {
      await this.longTermMemory.storeInteraction({
        personality,
        userMessage: this.buildContentForEmbedding(
          contentForStorage,
          referencedMessagesTextForSearch
        ),
        aiResponse: responseContent,
        context,
        personaId: personaResult.personaId,
        thinkingContent,
      });
    } else {
      logger.warn({ userId: context.userId }, 'No persona found, skipping LTM storage');
    }
  }

  /**
   * Build deferred memory data for later storage.
   * Used when memory storage is deferred (e.g., for duplicate detection retries).
   */
  async buildDeferredMemoryData(
    options: BuildDeferredMemoryDataOptions
  ): Promise<DeferredMemoryData | null> {
    const {
      context,
      personalityId,
      contentForStorage,
      responseContent,
      referencedMessagesTextForSearch,
      thinkingContent,
    } = options;
    const personaResult = await this.memoryRetriever.resolvePersonaForMemory(
      context.userId,
      personalityId
    );

    if (personaResult === null) {
      logger.warn({ userId: context.userId }, 'No persona found, cannot defer LTM');
      return null;
    }

    const hasThinking = thinkingContent !== undefined && thinkingContent.trim().length > 0;
    return {
      contentForEmbedding: this.buildContentForEmbedding(
        contentForStorage,
        referencedMessagesTextForSearch
      ),
      responseContent,
      personaId: personaResult.personaId,
      ...(hasThinking ? { thinkingContent } : {}),
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
    await this.longTermMemory.storeInteraction({
      personality,
      userMessage: deferredData.contentForEmbedding,
      aiResponse: deferredData.responseContent,
      context,
      personaId: deferredData.personaId,
      thinkingContent: deferredData.thinkingContent,
    });
    logger.info(
      { userId: context.userId, personalityId: personality.id, personaId: deferredData.personaId },
      'Stored deferred memory to LTM'
    );
  }
}
