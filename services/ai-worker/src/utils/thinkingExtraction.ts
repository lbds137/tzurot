/**
 * Thinking Block Extraction
 *
 * Extracts <think>...</think> blocks from AI responses.
 * Modern reasoning models (DeepSeek R1, Claude with reasoning, o1/o3, Gemini 2.0 with thinking)
 * may include thinking/reasoning content in these tags.
 *
 * This utility extracts the thinking content separately so it can be:
 * 1. Displayed to users (if showThinking is enabled)
 * 2. Excluded from the visible response
 * 3. Logged for debugging purposes
 */

import { createLogger } from '@tzurot/common-types';

const logger = createLogger('ThinkingExtraction');

export interface ThinkingExtraction {
  /** Content extracted from <think>...</think> tags, or null if no thinking blocks found */
  thinkingContent: string | null;
  /** The response content with thinking blocks removed */
  visibleContent: string;
  /** Number of thinking blocks that were extracted */
  blockCount: number;
}

/**
 * Pattern to match <think>...</think> blocks.
 *
 * Supports:
 * - Single-line: <think>short thought</think>
 * - Multi-line: <think>\nlong\nthought\n</think>
 * - Multiple blocks in the same response
 * - Case-insensitive tags
 *
 * Note: Uses non-greedy matching ([\s\S]*?) to handle nested-looking content
 * without accidentally capturing too much.
 */
const THINK_BLOCK_REGEX = /<think>([\s\S]*?)<\/think>/gi;

/**
 * Alternative patterns some models use:
 * - <thinking>...</thinking> (Claude format)
 * - <reasoning>...</reasoning> (some fine-tuned models)
 */
const ALTERNATIVE_PATTERNS = [
  /<thinking>([\s\S]*?)<\/thinking>/gi,
  /<reasoning>([\s\S]*?)<\/reasoning>/gi,
];

/**
 * Extract thinking blocks from AI response content.
 *
 * Models like DeepSeek R1, Claude with extended thinking, and Gemini with
 * thinking mode may include their reasoning process in `<think>` tags.
 * This function extracts that content for separate display.
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

  // Try primary pattern first
  const primaryMatches = content.matchAll(THINK_BLOCK_REGEX);
  for (const match of primaryMatches) {
    const thinkContent = match[1].trim();
    if (thinkContent.length > 0) {
      thinkingParts.push(thinkContent);
    }
  }

  // Remove primary pattern from visible content
  visibleContent = visibleContent.replace(THINK_BLOCK_REGEX, '');

  // Try alternative patterns if no primary matches found
  if (thinkingParts.length === 0) {
    for (const pattern of ALTERNATIVE_PATTERNS) {
      const altMatches = content.matchAll(pattern);
      for (const match of altMatches) {
        const thinkContent = match[1].trim();
        if (thinkContent.length > 0) {
          thinkingParts.push(thinkContent);
        }
      }
      // Remove this pattern from visible content
      visibleContent = visibleContent.replace(pattern, '');
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
  THINK_BLOCK_REGEX.lastIndex = 0; // Reset regex state
  if (THINK_BLOCK_REGEX.test(content)) {
    return true;
  }

  for (const pattern of ALTERNATIVE_PATTERNS) {
    pattern.lastIndex = 0; // Reset regex state
    if (pattern.test(content)) {
      return true;
    }
  }

  return false;
}
