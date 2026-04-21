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

import { createLogger, type MessageContent, type ReferencedMessage } from '@tzurot/common-types';
import { stripResponseArtifacts, stripUserMessageEcho } from '../utils/responseArtifacts.js';
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
  /**
   * Whether the model produced only analytical/reasoning content without roleplay.
   * Set when reasoning was enabled and the response looks like leaked chain-of-thought
   * (no dialogue markers, multiple analytical patterns). The caller should retry once.
   */
  onlyThinkingProduced: boolean;
}

/** Context needed for response processing */
interface ResponseProcessingContext {
  /** Personality name for artifact detection */
  personalityName: string;
  /** User's display name for placeholder replacement */
  userName: string;
  /** User's Discord username for placeholder replacement */
  discordUsername?: string;
  /** Whether reasoning was enabled for this request (triggers glitch detection) */
  reasoningEnabled?: boolean;
  /**
   * Model identifier (e.g. `moonshotai/kimi-k2.6`) for per-model diagnostics on
   * reasoning-did-not-engage events. Included in the warn log so log searches
   * can correlate extraction misses with specific upstream model releases
   * (e.g. detecting when a new model drops that produces unstructured CoT
   * output like Kimi K2.6 did vs. K2.5). Optional for callers/tests that
   * don't have a model context.
   */
  modelName?: string;
  /**
   * The user's incoming message for this turn. When present, the post-processor
   * will strip a leading verbatim echo of it from the response — some LLMs echo
   * the user's message as a prefix before their actual response. Optional so
   * existing callers (and tests) that don't plumb this through still work.
   */
  userMessage?: MessageContent;
}

/**
 * Analytical markers that indicate leaked chain-of-thought content.
 * These patterns appear in raw reasoning output but not in normal roleplay responses.
 *
 * The "I should"/"I need to" patterns are intentionally broad (no colon anchor)
 * because leaked CoT commonly starts lines this way. A persona saying "I need to
 * tell you something" in roleplay would match one marker, but the >= 2 threshold
 * plus the dialogue-marker gate makes false positives unlikely in practice.
 */
const ANALYTICAL_MARKERS = [
  /^The user[\s(]/m,
  /^(?:Key elements|Character voice|Tone|Avoid|Response structure):/m,
  /^(?:I should|I need to|Let me think|Looking at)/m,
  /^(?:Check against constraints|Final check|Important):/m,
];

/**
 * Detect if a response looks like leaked chain-of-thought rather than actual content.
 *
 * Simple smell test: if there's no dialogue content (quotes or roleplay asterisks)
 * but multiple analytical markers are present, it's likely a reasoning glitch.
 *
 * Known false-negative: leaked CoT using asterisks for emphasis (e.g., "I need to
 * *emphasize* this") bypasses the dialogue gate. Accepted trade-off — false negatives
 * (missed glitch → user sees raw CoT) are less harmful than false positives
 * (valid response suppressed → unnecessary retry).
 *
 * This is NOT a content modifier — it's a retry trigger. We don't try to extract
 * the thinking or modify the content, just signal the caller to retry.
 *
 * @internal Exported for testing only — not part of the stable API.
 */
export function looksLikeLeakedThinking(content: string): boolean {
  // If the response has dialogue markers, it's probably real content
  const hasDialogue = /["*]/.test(content);
  if (hasDialogue) {
    return false;
  }

  // Count analytical markers — need >= 2 for conservative detection
  const matchCount = ANALYTICAL_MARKERS.filter(r => r.test(content)).length;
  return matchCount >= 2;
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
        'Found reasoning in additional_kwargs'
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
        'Empty visible content - model only produced reasoning'
      );
    }

    // Merge all sources - API reasoning first, then inline
    const thinkingContent = mergeThinkingContent(apiReasoning, inlineThinking);

    if (apiReasoning !== null) {
      logger.debug(
        { apiReasoningLength: apiReasoning.length, hasInline: inlineThinking !== null },
        'Extracted API-level reasoning'
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

    // Step 4b: Strip leading verbatim echo of the user's incoming message.
    // Some LLMs learned to echo the incoming message as a prefix; existing
    // stripResponseArtifacts catches XML-wrapped variants, this catches the
    // plain-text variant. Safe no-op when userMessage is undefined.
    cleanedContent = stripUserMessageEcho(
      cleanedContent,
      context.userMessage,
      context.personalityName
    );

    // Step 5: Replace placeholders
    cleanedContent = replacePromptPlaceholders(
      cleanedContent,
      context.userName,
      context.personalityName,
      context.discordUsername
    );

    // Step 6: Glitch detection — check for leaked chain-of-thought
    // Only fires when reasoning was enabled AND tag-based extraction found nothing
    let onlyThinkingProduced = false;
    if (
      context.reasoningEnabled === true &&
      thinkingContent === null &&
      cleanedContent.length > 0 &&
      looksLikeLeakedThinking(cleanedContent)
    ) {
      onlyThinkingProduced = true;
      // contentLength only — full content appears in diagnostics collector
      logger.warn(
        { contentLength: cleanedContent.length },
        'Detected leaked chain-of-thought — signaling retry'
      );
    }

    // Step 7: Reasoning-mode actual-vs-requested telemetry. Some models
    // (notably `z-ai/glm-4.5-air:free`) accept a reasoning flag but don't
    // always actually emit reasoning — the response comes back as if
    // reasoning was disabled. When we're investigating model-inference
    // stickiness that produces duplicate responses, knowing whether
    // reasoning actually engaged for each turn is a load-bearing signal.
    //
    // Level split: engaged-as-expected is `info` (routine); ignored-flag
    // is `warn` so incident correlation (`@level:warn` grep) surfaces it
    // quickly without paging through every successful response.
    if (context.reasoningEnabled === true) {
      const reasoningActuallyEngaged = thinkingContent !== null && thinkingContent.length > 0;
      const apiReasoningLength = apiReasoning !== null ? apiReasoning.length : 0;
      const thinkingContentLength = thinkingContent !== null ? thinkingContent.length : 0;
      if (reasoningActuallyEngaged) {
        logger.info(
          {
            modelName: context.modelName,
            personalityName: context.personalityName,
            reasoningRequested: true,
            reasoningActuallyEngaged,
            apiReasoningLength,
            thinkingContentLength,
            cleanedContentLength: cleanedContent.length,
          },
          'Reasoning mode engaged as requested'
        );
      } else {
        logger.warn(
          {
            modelName: context.modelName,
            personalityName: context.personalityName,
            reasoningRequested: true,
            reasoningActuallyEngaged,
            apiReasoningLength,
            thinkingContentLength,
            cleanedContentLength: cleanedContent.length,
          },
          'Reasoning mode requested but did NOT engage — model ignored the flag'
        );
      }
    }

    return {
      cleanedContent,
      thinkingContent,
      wasDeduplicated,
      onlyThinkingProduced,
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
        'Filtered duplicate references from history'
      );
    }

    return filtered;
  }
}
