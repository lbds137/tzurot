/**
 * Thinking Block Extraction
 *
 * Extracts thinking/reasoning blocks from AI responses.
 *
 * Two extraction methods are supported:
 *
 * 1. **Inline Tags** (text content):
 *    - DeepSeek R1, Qwen QwQ, GLM-4.x, Kimi K2: <think>...</think>
 *    - Claude (prompted), Anthropic legacy: <thinking>...</thinking>, <ant_thinking>
 *    - Reflection AI: <reflection>...</reflection>
 *    - Legacy fine-tunes: <thought>...</thought>, <reasoning>...</reasoning>
 *    - Research models: <scratchpad>...</scratchpad>
 *
 * 2. **API-level Reasoning** (response metadata):
 *    - OpenRouter's `reasoning_details` array in response metadata
 *    - Types: reasoning.summary, reasoning.text, reasoning.encrypted
 *    - Used by: DeepSeek R1 via OpenRouter, Claude Extended Thinking
 *
 * This utility extracts the thinking content separately so it can be:
 * 1. Displayed to users (if showThinking is enabled) in Discord spoiler tags
 * 2. Excluded from the visible response
 * 3. Logged for debugging purposes
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
 * Pattern to match orphan closing tags with preceding content (no opening tag).
 * Some models (e.g., Kimi K2.5) may output thinking content without an opening tag,
 * just closing with </think>. This captures the content before the closing tag.
 * Matches: "thinking content here</think>visible response"
 */
const ORPHAN_CLOSING_TAG_PATTERN =
  /^([\s\S]*?)<\/(think|thinking|ant_thinking|reasoning|thought|reflection|scratchpad)>/i;

/**
 * Pattern to clean up "chimera artifacts" - short garbage fragments before orphan closing tags.
 * Some merged/chimera models (e.g., tng-r1t-chimera) output a stutter pattern.
 * Note: Whitespace limited to {0,50} to prevent ReDoS on pathological input.
 */
const CHIMERA_ARTIFACT_PATTERN =
  /(?:^|[\r\n])[\s]{0,50}[^\s<.]{0,9}\.[\s]{0,50}<\/(think|thinking|ant_thinking|reasoning|thought|reflection|scratchpad)>/gi;

/**
 * Pattern to remove any remaining orphan closing tags.
 */
const ORPHAN_CLOSING_TAG_CLEANUP =
  /<\/(think|thinking|ant_thinking|reasoning|thought|reflection|scratchpad)>/gi;

/** Minimum content length to extract from orphan closing tags */
const MIN_ORPHAN_CONTENT_LENGTH = 20;

/**
 * Extract content from unclosed thinking tags (model truncation fallback).
 * @returns Extracted content and cleaned visible content, or null if no match
 */
function extractUnclosedTag(visibleContent: string): { content: string; cleaned: string } | null {
  UNCLOSED_TAG_PATTERN.lastIndex = 0;
  const match = UNCLOSED_TAG_PATTERN.exec(visibleContent);
  if (match === null) {
    return null;
  }

  const tagName = match[1];
  const content = match[2].trim();
  if (content.length === 0) {
    return null;
  }

  logger.warn(
    { tagName, contentLength: content.length },
    '[ThinkingExtraction] Found unclosed thinking tag - content may be incomplete'
  );

  UNCLOSED_TAG_PATTERN.lastIndex = 0;
  const cleaned = visibleContent.replace(UNCLOSED_TAG_PATTERN, '');
  return { content, cleaned };
}

/**
 * Extract content from orphan closing tags (no opening tag).
 * @returns Extracted content and cleaned visible content, or null if no match
 */
function extractOrphanClosingTag(
  visibleContent: string
): { content: string; cleaned: string } | null {
  const match = ORPHAN_CLOSING_TAG_PATTERN.exec(visibleContent);
  if (match === null) {
    return null;
  }

  const content = match[1].trim();
  const tagName = match[2];

  if (content.length < MIN_ORPHAN_CONTENT_LENGTH) {
    return null;
  }

  logger.warn(
    { tagName, contentLength: content.length },
    '[ThinkingExtraction] Found orphan closing tag - extracted preceding content as thinking'
  );

  const cleaned = visibleContent.replace(ORPHAN_CLOSING_TAG_PATTERN, '');
  return { content, cleaned };
}

/**
 * Clean up visible content after extraction.
 */
function cleanupVisibleContent(content: string): string {
  // Clean chimera artifacts
  let result = content.replace(CHIMERA_ARTIFACT_PATTERN, '');

  // Remove remaining orphan closing tags
  result = result.replace(ORPHAN_CLOSING_TAG_CLEANUP, '');

  // Clean whitespace
  return result
    .replace(/^\s+/, '') // Leading whitespace
    .replace(/\s+$/, '') // Trailing whitespace
    .replace(/\n{3,}/g, '\n\n'); // Multiple blank lines to double
}

/**
 * Extract text or summary from a reasoning detail object.
 */
function extractFromReasoningDetail(detail: ReasoningDetail): string | null {
  if (typeof detail.text === 'string' && detail.text.trim().length > 0) {
    return detail.text.trim();
  }
  if (typeof detail.summary === 'string' && detail.summary.trim().length > 0) {
    return detail.summary.trim();
  }
  return null;
}

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
    pattern.lastIndex = 0;
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const thinkContent = match[1].trim();
      if (thinkContent.length > 0) {
        thinkingParts.push(thinkContent);
      }
    }
    pattern.lastIndex = 0;
    visibleContent = visibleContent.replace(pattern, '');
  }

  // Handle unclosed tags as fallback (only if no complete tags found)
  if (thinkingParts.length === 0) {
    const unclosed = extractUnclosedTag(visibleContent);
    if (unclosed !== null) {
      thinkingParts.push(unclosed.content);
      visibleContent = unclosed.cleaned;
    }
  }

  // Handle orphan closing tags as fallback (only if still no content found)
  if (thinkingParts.length === 0) {
    const orphan = extractOrphanClosingTag(visibleContent);
    if (orphan !== null) {
      thinkingParts.push(orphan.content);
      visibleContent = orphan.cleaned;
    }
  }

  // Clean up visible content (chimera artifacts, orphan tags, whitespace)
  visibleContent = cleanupVisibleContent(visibleContent);

  // Combine thinking parts if multiple blocks
  const thinkingContent = thinkingParts.length > 0 ? thinkingParts.join('\n\n---\n\n') : null;

  const blockCount = thinkingParts.length;

  if (blockCount > 0) {
    const thinkingLength = thinkingContent?.length ?? 0;
    logger.info(
      { blockCount, thinkingLength, visibleLength: visibleContent.length },
      `[ThinkingExtraction] Extracted ${blockCount} thinking block(s) (${thinkingLength} chars)`
    );
  }

  return { thinkingContent, visibleContent, blockCount };
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

/**
 * OpenRouter reasoning detail types.
 *
 * @see https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
 */
export interface ReasoningDetail {
  /** Type of reasoning content (known types or any string for forward compatibility) */
  type: string;
  /** Reasoning ID (if provided) */
  id?: string | null;
  /** Format indicator (known formats or any string for forward compatibility) */
  format?: string;
  /** Index for ordering */
  index?: number;
  /** Summary content (for reasoning.summary type) */
  summary?: string;
  /** Text content (for reasoning.text type) */
  text?: string;
  /** Encrypted data (for reasoning.encrypted type) */
  data?: string;
  /** Signature for verification (optional) */
  signature?: string;
}

/**
 * Extract reasoning content from OpenRouter's reasoning_details array.
 *
 * OpenRouter returns API-level reasoning in a structured format separate from
 * the text content. This is used by models like DeepSeek R1, Claude Extended
 * Thinking, and other reasoning models when `reasoning.exclude: false` is set.
 *
 * @param reasoningDetails - Array of reasoning detail objects from response metadata
 * @returns Extracted reasoning text, or null if no readable content found
 *
 * @example
 * ```typescript
 * const metadata = response.response_metadata;
 * const apiReasoning = extractApiReasoningContent(metadata?.reasoning_details);
 * ```
 */
export function extractApiReasoningContent(reasoningDetails: unknown): string | null {
  if (!Array.isArray(reasoningDetails) || reasoningDetails.length === 0) {
    return null;
  }

  const parts: string[] = [];

  for (const detail of reasoningDetails) {
    if (detail === null || typeof detail !== 'object') {
      continue;
    }

    const typedDetail = detail as ReasoningDetail;
    const extracted = processReasoningDetail(typedDetail, parts);
    if (extracted !== null) {
      parts.push(extracted);
    }
  }

  if (parts.length === 0) {
    return null;
  }

  const content = parts.join('\n\n---\n\n');

  logger.info(
    {
      detailCount: reasoningDetails.length,
      extractedParts: parts.length,
      contentLength: content.length,
    },
    `[ThinkingExtraction] Extracted API-level reasoning from ${parts.length} detail(s)`
  );

  return content;
}

/**
 * Process a single reasoning detail and return extracted content.
 */
function processReasoningDetail(detail: ReasoningDetail, _parts: string[]): string | null {
  switch (detail.type) {
    case 'reasoning.text':
    case 'reasoning.summary':
      return extractFromReasoningDetail(detail);

    case 'reasoning.encrypted':
      logger.debug(
        { type: detail.type, format: detail.format },
        '[ThinkingExtraction] Found encrypted reasoning content (cannot extract)'
      );
      return null;

    default:
      return extractFromReasoningDetail(detail);
  }
}

/**
 * Merge thinking content from multiple sources.
 *
 * Combines API-level reasoning (from reasoning_details) with inline tag extraction.
 * API-level reasoning is displayed first if present, followed by inline tags.
 *
 * @param apiReasoning - Content from extractApiReasoningContent()
 * @param inlineReasoning - Content from extractThinkingBlocks()
 * @returns Combined thinking content, or null if both are null/empty
 */
export function mergeThinkingContent(
  apiReasoning: string | null,
  inlineReasoning: string | null
): string | null {
  const hasApi = apiReasoning !== null && apiReasoning.length > 0;
  const hasInline = inlineReasoning !== null && inlineReasoning.length > 0;

  if (!hasApi && !hasInline) {
    return null;
  }

  if (hasApi && !hasInline) {
    return apiReasoning;
  }

  if (!hasApi && hasInline) {
    return inlineReasoning;
  }

  // Both present - combine with clear section separation
  return `${apiReasoning}\n\n=== Additional Inline Reasoning ===\n\n${inlineReasoning}`;
}
