/**
 * Response Post-Processor
 *
 * Handles cleaning and processing of raw LLM responses:
 * - Reasoning/thinking extraction (API-level and inline)
 * - Response deduplication (stop-token failure handling)
 * - Artifact stripping (system prompt leakage)
 * - Placeholder replacement
 * - Reference filtering
 */

import { createLogger, type ReferencedMessage } from '@tzurot/common-types';
import { stripResponseArtifacts } from '../utils/responseArtifacts.js';
import { removeDuplicateResponse } from '../utils/duplicateDetection.js';
import {
  extractThinkingBlocks,
  extractApiReasoningContent,
  mergeThinkingContent,
} from '../utils/thinkingExtraction.js';
import { replacePromptPlaceholders } from '../utils/promptPlaceholders.js';

const logger = createLogger('ResponsePostProcessor');

/** Result of processing a raw LLM response */
interface ProcessedResponse {
  /** Cleaned visible content for the user */
  cleanedContent: string;
  /** Extracted thinking/reasoning content (if any) */
  thinkingContent: string | null;
  /** Whether deduplication was applied */
  wasDeduplicated: boolean;
}

/** Context needed for response processing */
interface ResponseProcessingContext {
  /** Personality name for artifact detection */
  personalityName: string;
  /** User's display name for placeholder replacement */
  userName: string;
  /** User's Discord username for placeholder replacement */
  discordUsername?: string;
}

/**
 * Post-processes raw LLM responses into clean, user-ready content
 */
export class ResponsePostProcessor {
  /**
   * Extract API-level reasoning content from response metadata.
   * Handles DeepSeek R1, Claude, and other reasoning model formats.
   */
  extractApiReasoning(
    additionalKwargs: { reasoning?: string } | undefined,
    responseMetadata: { reasoning_details?: unknown[] } | undefined
  ): string | null {
    // First check additional_kwargs.reasoning (primary location for DeepSeek R1)
    if (
      additionalKwargs?.reasoning !== undefined &&
      typeof additionalKwargs.reasoning === 'string' &&
      additionalKwargs.reasoning.length > 0
    ) {
      logger.debug(
        { reasoningLength: additionalKwargs.reasoning.length },
        '[ResponsePostProcessor] Found reasoning in additional_kwargs'
      );
      return additionalKwargs.reasoning;
    }
    // Fall back to reasoning_details array (some providers use this format)
    return extractApiReasoningContent(responseMetadata?.reasoning_details);
  }

  /**
   * Process thinking content from model response.
   *
   * Extracts inline thinking blocks and merges with API-level reasoning.
   * When visible content is empty but thinking exists, returns empty visible
   * content rather than using thinking as the response (prevents reasoning leak).
   */
  processThinkingContent(
    deduplicatedContent: string,
    apiReasoning: string | null
  ): { visibleContent: string; thinkingContent: string | null } {
    const { thinkingContent: inlineThinking, visibleContent: extractedVisibleContent } =
      extractThinkingBlocks(deduplicatedContent);

    const visibleContent = extractedVisibleContent;

    // Log when model produces only thinking content
    if (
      visibleContent.trim().length === 0 &&
      inlineThinking !== null &&
      inlineThinking.length > 0
    ) {
      logger.warn(
        { inlineThinkingLength: inlineThinking.length, hasApiReasoning: apiReasoning !== null },
        '[ResponsePostProcessor] Empty visible content - model only produced reasoning'
      );
    }

    // Merge all sources - API reasoning first, then inline
    const thinkingContent = mergeThinkingContent(apiReasoning, inlineThinking);

    if (apiReasoning !== null) {
      logger.debug(
        { apiReasoningLength: apiReasoning.length, hasInline: inlineThinking !== null },
        '[ResponsePostProcessor] Extracted API-level reasoning'
      );
    }

    return { visibleContent, thinkingContent };
  }

  /**
   * Process a raw LLM response into clean, user-ready content.
   *
   * Pipeline:
   * 1. Remove duplicate content (stop-token failure handling)
   * 2. Extract API-level reasoning
   * 3. Extract inline thinking blocks
   * 4. Strip response artifacts (system prompt leakage)
   * 5. Replace prompt placeholders with actual names
   */
  processResponse(
    rawContent: string,
    additionalKwargs: { reasoning?: string } | undefined,
    responseMetadata: { reasoning_details?: unknown[] } | undefined,
    context: ResponseProcessingContext
  ): ProcessedResponse {
    // Step 1: Remove duplicate content (stop-token failure bug)
    const deduplicatedContent = removeDuplicateResponse(rawContent);
    const wasDeduplicated = rawContent !== deduplicatedContent;

    // Step 2: Extract API-level reasoning
    const apiReasoning = this.extractApiReasoning(additionalKwargs, responseMetadata);

    // Step 3: Process inline thinking blocks
    const { visibleContent, thinkingContent } = this.processThinkingContent(
      deduplicatedContent,
      apiReasoning
    );

    // Step 4: Strip artifacts
    let cleanedContent = stripResponseArtifacts(visibleContent, context.personalityName);

    // Step 5: Replace placeholders
    cleanedContent = replacePromptPlaceholders(
      cleanedContent,
      context.userName,
      context.personalityName,
      context.discordUsername
    );

    return {
      cleanedContent,
      thinkingContent,
      wasDeduplicated,
    };
  }

  /**
   * Filter out referenced messages that are already in conversation history.
   *
   * Prevents token waste from duplicating content. When a user replies to
   * a recent message, that message is likely already in the conversation history.
   */
  filterDuplicateReferences(
    referencedMessages: ReferencedMessage[] | undefined,
    conversationHistory: { id?: string }[] | undefined
  ): ReferencedMessage[] {
    if (!referencedMessages || referencedMessages.length === 0) {
      return [];
    }

    if (!conversationHistory || conversationHistory.length === 0) {
      return referencedMessages;
    }

    // Build set of message IDs from conversation history
    const historyIds = new Set<string>();
    for (const msg of conversationHistory) {
      if (msg.id !== undefined && msg.id.length > 0) {
        historyIds.add(msg.id);
      }
    }

    // Filter out referenced messages that are already in history
    // Preserve deduped stubs — they carry the reply-target signal with truncated content
    const filtered = referencedMessages.filter(
      ref => ref.isDeduplicated === true || !historyIds.has(ref.discordMessageId)
    );

    if (filtered.length < referencedMessages.length) {
      const removed = referencedMessages.length - filtered.length;
      logger.debug(
        {
          originalCount: referencedMessages.length,
          filteredCount: filtered.length,
          removedCount: removed,
        },
        '[ResponsePostProcessor] Filtered duplicate references from history'
      );
    }

    return filtered;
  }
}
