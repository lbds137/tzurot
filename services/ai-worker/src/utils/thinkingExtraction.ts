/**
 * Thinking Block Extraction
 *
 * Extracts thinking/reasoning blocks from AI responses.
 *
 * Supported models and their tag formats:
 * - DeepSeek R1, Qwen QwQ, GLM-4.x, Kimi K2: <think>...</think>
 * - Claude (prompted), Anthropic legacy: <thinking>...</thinking>, <ant_thinking>
 * - Reflection AI: <reflection>...</reflection>
 * - Legacy fine-tunes: <thought>...</thought>, <reasoning>...</reasoning>
 * - Research models: <scratchpad>...</scratchpad>
 *
 * This utility extracts the thinking content separately so it can be:
 * 1. Displayed to users (if showThinking is enabled) in Discord spoiler tags
 * 2. Excluded from the visible response
 * 3. Logged for debugging purposes
 *
 * Note: API-level thinking (Claude Extended Thinking, Gemini, OpenAI o1/o3) is
 * handled separately by LangChain and doesn't appear in text content.
 */

import { createLogger } from '@tzurot/common-types';

const logger = createLogger('ThinkingExtraction');

export interface ThinkingExtraction {
  /** Content extracted from thinking tags, or null if no thinking blocks found */
  thinkingContent: string | null;
  /** The response content with thinking blocks removed */
  visibleContent: string;
  /** Number of thinking blocks that were extracted */
  blockCount: number;
}

/**
 * All supported thinking tag patterns.
 *
 * Each pattern captures the content inside the tags for extraction.
 * Uses non-greedy matching ([\s\S]*?) to handle content without over-capturing.
 * All patterns are case-insensitive.
 *
 * Order matters for extraction priority (first match wins for display),
 * but ALL patterns are always removed from visible content.
 */
const THINKING_PATTERNS = [
  // Primary: DeepSeek R1, Qwen QwQ, GLM-4.x, Kimi K2
  /<think>([\s\S]*?)<\/think>/gi,
  // Claude prompted, some distilled models
  /<thinking>([\s\S]*?)<\/thinking>/gi,
  // Legacy Anthropic format
  /<ant_thinking>([\s\S]*?)<\/ant_thinking>/gi,
  // Some fine-tuned models
  /<reasoning>([\s\S]*?)<\/reasoning>/gi,
  // Legacy fine-tunes (Llama, Mistral)
  /<thought>([\s\S]*?)<\/thought>/gi,
  // Reflection AI
  /<reflection>([\s\S]*?)<\/reflection>/gi,
  // Legacy research models
  /<scratchpad>([\s\S]*?)<\/scratchpad>/gi,
] as const;

/**
 * Pattern to match unclosed thinking tags (model truncation or errors).
 * Matches opening tag followed by content until end of string.
 * Only used as a fallback when no complete tags are found.
 */
const UNCLOSED_TAG_PATTERN =
  /<(think|thinking|ant_thinking|reasoning|thought|reflection|scratchpad)>([\s\S]*)$/gi;

/**
 * Extract thinking blocks from AI response content.
 *
 * Models like DeepSeek R1, Qwen QwQ, GLM-4.x, and Claude with prompted thinking
 * may include their reasoning process in XML-like tags.
 * This function extracts that content for optional display in Discord spoiler tags.
 *
 * IMPORTANT: ALL thinking patterns are ALWAYS removed from visible content,
 * regardless of which patterns matched. This prevents tag leakage.
 *
 * @param content - The raw AI response content
 * @returns Extraction result with thinking content separated from visible content
 *
 * @example
 * ```typescript
 * const result = extractThinkingBlocks(
 *   '<think>Let me analyze this...</think>The answer is 42.'
 * );
 * // result.thinkingContent: 'Let me analyze this...'
 * // result.visibleContent: 'The answer is 42.'
 * // result.blockCount: 1
 * ```
 */
export function extractThinkingBlocks(content: string): ThinkingExtraction {
  const thinkingParts: string[] = [];
  let visibleContent = content;

  // Extract thinking content from ALL patterns and ALWAYS remove from visible content
  // This prevents tag leakage when responses contain multiple tag types
  for (const pattern of THINKING_PATTERNS) {
    // Reset regex state for each pattern (global regexes maintain lastIndex)
    pattern.lastIndex = 0;

    // Extract content from this pattern
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const thinkContent = match[1].trim();
      if (thinkContent.length > 0) {
        thinkingParts.push(thinkContent);
      }
    }

    // ALWAYS remove this pattern from visible content (critical for preventing leaks)
    pattern.lastIndex = 0;
    visibleContent = visibleContent.replace(pattern, '');
  }

  // Handle unclosed tags (model truncation or errors) as a fallback
  // Only if no complete tags were found - unclosed tags are likely incomplete thoughts
  if (thinkingParts.length === 0) {
    UNCLOSED_TAG_PATTERN.lastIndex = 0;
    const unclosedMatch = UNCLOSED_TAG_PATTERN.exec(visibleContent);
    if (unclosedMatch !== null) {
      const tagName = unclosedMatch[1];
      const unclosedContent = unclosedMatch[2].trim();
      if (unclosedContent.length > 0) {
        thinkingParts.push(unclosedContent);
        logger.warn(
          { tagName, contentLength: unclosedContent.length },
          '[ThinkingExtraction] Found unclosed thinking tag - content may be incomplete'
        );
      }
      // Remove the unclosed tag from visible content
      UNCLOSED_TAG_PATTERN.lastIndex = 0;
      visibleContent = visibleContent.replace(UNCLOSED_TAG_PATTERN, '');
    }
  }

  // Clean up visible content (remove extra whitespace from removed blocks)
  visibleContent = visibleContent
    .replace(/^\s+/, '') // Leading whitespace
    .replace(/\s+$/, '') // Trailing whitespace
    .replace(/\n{3,}/g, '\n\n'); // Multiple blank lines to double

  // Combine thinking parts if multiple blocks
  const thinkingContent =
    thinkingParts.length > 0
      ? thinkingParts.join('\n\n---\n\n') // Separate multiple blocks with divider
      : null;

  const blockCount = thinkingParts.length;

  if (blockCount > 0) {
    const thinkingLength = thinkingContent?.length ?? 0;
    logger.info(
      { blockCount, thinkingLength, visibleLength: visibleContent.length },
      `[ThinkingExtraction] Extracted ${blockCount} thinking block(s) (${thinkingLength} chars)`
    );
  }

  return {
    thinkingContent,
    visibleContent,
    blockCount,
  };
}

/**
 * Check if a response contains thinking blocks without fully extracting them.
 * Useful for quick checks before doing full extraction.
 *
 * @param content - The response content to check
 * @returns true if any thinking blocks are present
 */
export function hasThinkingBlocks(content: string): boolean {
  for (const pattern of THINKING_PATTERNS) {
    pattern.lastIndex = 0; // Reset regex state
    if (pattern.test(content)) {
      return true;
    }
  }

  // Also check for unclosed tags
  UNCLOSED_TAG_PATTERN.lastIndex = 0;
  if (UNCLOSED_TAG_PATTERN.test(content)) {
    return true;
  }

  return false;
}
