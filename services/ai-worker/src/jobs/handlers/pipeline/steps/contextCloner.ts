/**
 * Context Cloner Utility
 *
 * Deep clones conversation context to isolate retry attempts from mutations.
 * Extracted from GenerationStep to maintain file size limits.
 */

import type { ConversationContext } from '../../../../services/ConversationalRAGService.js';

/**
 * Clone the conversation context for retry isolation.
 *
 * The RAG service may mutate rawConversationHistory in-place (e.g., injectImageDescriptions),
 * which would affect subsequent retry attempts if not cloned. This ensures each retry gets
 * a fresh context to work with.
 */
export function cloneContextForRetry(context: ConversationContext): ConversationContext {
  return {
    ...context,
    rawConversationHistory: context.rawConversationHistory?.map(entry => ({
      ...entry,
      // Deep clone messageMetadata to prevent mutation bleeding
      messageMetadata: entry.messageMetadata
        ? {
            ...entry.messageMetadata,
            // Clone nested arrays if present
            referencedMessages: entry.messageMetadata.referencedMessages
              ? [...entry.messageMetadata.referencedMessages]
              : undefined,
            imageDescriptions: entry.messageMetadata.imageDescriptions
              ? [...entry.messageMetadata.imageDescriptions]
              : undefined,
            reactions: entry.messageMetadata.reactions
              ? [...entry.messageMetadata.reactions]
              : undefined,
          }
        : undefined,
    })),
  };
}
