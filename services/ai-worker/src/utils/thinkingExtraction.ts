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
 *    - GLM 4.5 Air: <character_analysis>...</character_analysis> (internal CoT)
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

interface ThinkingExtraction {
  /** Content extracted from thinking tags, or null if no thinking blocks found */
  thinkingContent: string | null;
  /** The response content with thinking blocks removed */
  visibleContent: string;
  /** Number of thinking blocks that were extracted */
  blockCount: number;
}

/**
 * All known thinking/reasoning tag names.
 *
 * Single source of truth — every pattern in this module is generated from
 * this array. To add support for a new tag, add it here and all patterns
 * (extraction, normalization, fallback, cleanup) update automatically.
 *
 * CONSTRAINT: Tag names must use only [a-z_] characters (no regex
 * metacharacters), since names are interpolated directly into patterns.
 */
const KNOWN_THINKING_TAGS = [
  'think', // DeepSeek R1, Qwen QwQ, GLM-4.x, Kimi K2
  'thinking', // Claude prompted, some distilled models
  'ant_thinking', // Legacy Anthropic format
  'reasoning', // Some fine-tuned models
  'thought', // Legacy fine-tunes (Llama, Mistral)
  'reflection', // Reflection AI
  'scratchpad', // Legacy research models
  'character_analysis', // GLM 4.5 Air internal chain-of-thought
  'understanding', // GLM 4.5 Air (observed 2026-04-22, reasoning=medium, req deb8b063)
] as const;

/**
 * GLM-4.5-Air fake-user-message-echo pattern.
 *
 * Observed 2026-04-22 (req b533e288-fb07-46c0-a5e2-a0f78883e63e): with
 * `reasoning.enabled=true` and no OpenRouter-side reasoning extraction,
 * GLM-4.5-Air improvised a reasoning channel by wrapping its chain-of-thought
 * in tags that mimic our prompt-assembly format:
 *
 *   <from_id>UUID</from_id>
 *   <user>Display Name</user>
 *   <message>... chain of thought here ...</message>
 *
 *   <actual in-character response>
 *
 * The three structural rules that make this safe to extract (not just strip):
 *   1. Start-of-response anchor (`^\s*`) — mid-response matches are left alone.
 *   2. UUID validation (RFC 4122 hyphen layout 8-4-4-4-12, hex-only
 *      character classes) — no legitimate roleplay output starts with an
 *      invisible UUID-shaped block; UUIDs only appear in our internal
 *      assembly format. The explicit hyphen positions are load-bearing —
 *      a loose `[a-fA-F0-9-]{36}` character class would match edge cases
 *      like 36 hyphens or 36 repeated hex digits.
 *   3. Strict tag sequence (`<from_id>` → `<user>` → `<message>`) — all three
 *      in order with standard whitespace between them.
 *
 * False-positive risk: effectively zero. The UUID shape is the load-bearing
 * guarantee; the tag names are scaffolding around it.
 *
 * Interaction with `normalizeThinkingTagNamespaces`: the upstream namespace
 * normalization only rewrites tags whose name is in `KNOWN_THINKING_TAGS`
 * (think/thinking/ant_thinking/reasoning/thought/reflection/scratchpad/
 * character_analysis/understanding). `<from_id>`, `<user>`, and `<message>`
 * are not in that list, so normalization will not rewrite them and this
 * pattern is safe against a `<ns:from_id>`-style future leak. If the
 * `KNOWN_THINKING_TAGS` list is ever expanded to include overlap with these
 * scaffolding tag names, re-verify.
 *
 * `^` anchor is intentional absolute start-of-string (no `m` flag). The
 * pattern must only fire when the wrapper dominates the whole response;
 * an `m`-flagged `^` would match any line start and would incorrectly
 * strip mid-response occurrences of the format (e.g. in meta-conversation
 * about the format).
 *
 * Architecture: this is a "model-specific pattern extractor" that runs as a
 * first pass in `extractThinkingBlocks`, before the generic `KNOWN_THINKING_TAGS`
 * loop. Council (Gemini 3.1 Pro Preview, 2026-04-22) recommended the
 * Chain-of-Extractors pattern: complex model-specific regexes first,
 * simple generic tag patterns second.
 *
 * Deletion plan: once OpenRouter's reasoning-extractor middleware handles
 * this upstream (they actively polyfill similar quirks for DeepSeek/Qwen/Llama),
 * this pattern can be removed. File an issue with them with the raw API
 * response as evidence.
 */
const GLM_FAKE_USER_MESSAGE_ECHO_PATTERN =
  /^\s*<from_id>[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}<\/from_id>\s*<user>[^<]*<\/user>\s*<message>([\s\S]*?)<\/message>\s*/;

/**
 * GLM-4.7 meta-preamble pattern.
 *
 * Observed 2026-04-24 (req 9b2aa0f3-d659-4f00-95f4-36da3a9b40f3): with
 * `reasoning.enabled=true` and `showThinking=false`, GLM-4.7 emitted a scene-
 * setting preamble before the in-character response:
 *
 *   <user>Lila</user>
 *   <character>Lilith</character>
 *   <analysis>
 *   ...chain of thought about tone, persona, format...
 *   </analysis>
 *
 *   <actual in-character response>
 *
 * Same bug class as GLM-4.5-Air's fake-user-message echo — the model's RL
 * training surfaces reasoning as XML-tagged meta-content rather than through
 * OpenAI's `reasoning` field. Different tag vocabulary per revision; each
 * needs its own extractor.
 *
 * Load-bearing guarantees (what makes this safe to strip):
 *   1. Start-of-response anchor (`^\s*`) — mid-response meta-discussion about
 *      the format is not stripped.
 *   2. Presence of `<analysis>` as a required terminator — the `<user>` and
 *      `<character>` tags alone wouldn't anchor anything (both words appear
 *      in normal response prose). `<analysis>` at the start of a response is
 *      statistically a leak marker.
 *   3. Tag-closure matching via backreference (`<\/\1>`) — a `<user>` opener
 *      only matches a `</user>` closer, preventing tag crossings from
 *      accidentally eating into the real response body.
 *
 * False-positive risk: low but higher than the 4.5-Air pattern, which had
 * UUID validation as an additional bedrock guarantee. The tag vocabulary
 * here is load-bearing — a legitimate response rarely starts with
 * `<analysis>`. If that assumption breaks (e.g., a personality is prompted
 * to output `<analysis>` as a structured-output format), shrink this
 * pattern. Concretely: change `{0,2}` to `{1,2}` so the regex requires at
 * least one `<user>` or `<character>` preamble tag — this eliminates bare-
 * `<analysis>` matches at the cost of breaking the "handles bare <analysis>
 * with no preamble tags" test case. Do that rather than weakening the
 * start-of-response anchor, which is the primary safety guarantee.
 *
 * Structural flexibility vs. the 4.5-Air pattern:
 *   - `<user>` and `<character>` are OPTIONAL preamble — either, both, or
 *     neither may appear, in any order. Observed variant had all three; future
 *     variants may drop some. Permutation tolerance avoids re-opening the bug
 *     if the model changes its output shape slightly.
 *   - `</analysis>` is OPTIONAL terminator via `(?:<\/analysis>|$)`. If the
 *     model hits `max_tokens` mid-reasoning, the closing tag is absent.
 *     Without the `|$` alternative, the regex would fail and the raw XML
 *     would leak in full — worse than the non-extraction case. Eating to
 *     end-of-string on truncation is the safer failure mode.
 *
 * Case-insensitive (`/i`) because the model has been observed to lowercase
 * tags inconsistently. Anchors remain absolute (no `m` flag).
 *
 * Architecture: runs in `extractThinkingBlocks` Pass 1 alongside the 4.5-Air
 * pattern. When multiple GLM-family patterns match, each consumes its own
 * scaffolding from the response head; their order is irrelevant because each
 * is tightly anchored by a distinct tag vocabulary.
 *
 * Deletion plan: same as the 4.5-Air pattern — once OpenRouter's reasoning
 * middleware polyfills this model's leak pattern upstream, remove this entry.
 * Filing with the raw API response as evidence is the fastest path.
 */
const GLM_47_META_PREAMBLE_PATTERN =
  /^\s*(?:<(user|character)>[^<]*<\/\1>\s*){0,2}(?:<analysis>([\s\S]*?)(?:<\/analysis>|$))\s*/i;

/**
 * Alternation pattern fragment for use in regex: `think|thinking|...`
 *
 * Order is safe — all usage sites have structural terminators (`>`, `\b`)
 * that prevent `think` from matching as a prefix of `thinking`.
 */
const TAG_ALT = KNOWN_THINKING_TAGS.join('|');

/**
 * Per-tag extraction patterns. Each captures the content inside the tags.
 * Uses non-greedy matching ([\s\S]*?) to handle content without over-capturing.
 * All patterns are case-insensitive (`gi` flags).
 *
 * Order matters for extraction priority (first match wins for display),
 * but ALL patterns are always removed from visible content.
 */
const THINKING_PATTERNS: readonly RegExp[] = KNOWN_THINKING_TAGS.map(
  tag => new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi')
);

/**
 * Strip any XML namespace prefix from known thinking tag names. GLM-4.5-Air leaks Anthropic's
 * training data namespace into generated tags. Restrict to known tags to avoid side effects.
 * The \b anchor prevents false matches on hypothetical tags like <thinker>.
 */
function normalizeThinkingTagNamespaces(content: string): string {
  return content.replace(new RegExp(`<(\\/?)[a-z][a-z0-9]*:(${TAG_ALT})\\b`, 'gi'), '<$1$2');
}

/**
 * Pattern to match unclosed thinking tags (model truncation or errors).
 * Matches opening tag followed by content until end of string.
 * Only used as a fallback when no complete tags are found.
 */
const UNCLOSED_TAG_PATTERN = new RegExp(`<(${TAG_ALT})>([\\s\\S]*)$`, 'gi');

/**
 * Pattern to match orphan closing tags with preceding content (no opening tag).
 * Some models (e.g., Kimi K2.5) may output thinking content without an opening tag,
 * just closing with </think>. This captures the content before the closing tag.
 * Matches: "thinking content here</think>visible response"
 */
const ORPHAN_CLOSING_TAG_PATTERN = new RegExp(`^([\\s\\S]*?)<\\/(${TAG_ALT})>`, 'i');

/**
 * Pattern to clean up "chimera artifacts" - short garbage fragments before orphan closing tags.
 * Some merged/chimera models (e.g., tng-r1t-chimera) output a stutter pattern.
 * Note: Whitespace limited to {0,50} to prevent ReDoS on pathological input.
 */
const CHIMERA_ARTIFACT_PATTERN = new RegExp(
  `(?:^|[\\r\\n])[\\s]{0,50}[^\\s<.]{0,9}\\.[\\s]{0,50}<\\/(${TAG_ALT})>`,
  'gi'
);

/**
 * Pattern to remove any remaining orphan closing tags.
 */
const ORPHAN_CLOSING_TAG_CLEANUP = new RegExp(`<\\/(${TAG_ALT})>`, 'gi');

/**
 * Pattern to clean up OpenAI "Harmony" format tokens that leak from GPT-OSS-120B.
 * These are raw training tokens that sometimes appear in the model's output:
 *   <|start|>assistant<|channel|>analysis...
 *   <|end|>
 * Note: Uses non-greedy matching with a length cap to prevent pathological backtracking.
 */
const HARMONY_TOKEN_PATTERN = /<\|(?:start|end|channel|separator|im_start|im_end)\|>/gi;

/** Minimum content length to extract from orphan closing tags */
const MIN_ORPHAN_CONTENT_LENGTH = 20;

/** Opening tag pattern for stripping bare tags without capturing content */
const OPENING_TAG_PATTERN = new RegExp(`<(${TAG_ALT})>`, 'gi');

/**
 * Extract content from unclosed thinking tags (model truncation fallback).
 *
 * When the unclosed tag would consume the entire response (no visible content
 * remains after extraction), this is likely a model glitch (e.g. GLM 4.5 Air
 * forgetting to close the tag) rather than genuine truncated reasoning. In that
 * case, we strip the opening tag and keep all content visible.
 *
 * @returns Object with extracted thinking and remaining visible, or null if no match
 */
function extractUnclosedTag(
  visibleContent: string
): { thinkingContent: string; visibleContent: string } | null {
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
    'Found unclosed thinking tag - content may be incomplete'
  );

  UNCLOSED_TAG_PATTERN.lastIndex = 0;
  const cleaned = visibleContent.replace(UNCLOSED_TAG_PATTERN, '');

  // If extraction would leave visible content empty, this is likely a model glitch
  // (e.g. GLM 4.5 Air). Strip the opening tag instead and keep content visible.
  if (cleaned.trim().length === 0) {
    logger.warn(
      { contentLength: content.length },
      'Unclosed tag would consume entire response — keeping content visible'
    );
    return {
      thinkingContent: '',
      visibleContent: visibleContent.replace(OPENING_TAG_PATTERN, '').trim(),
    };
  }

  return { thinkingContent: content, visibleContent: cleaned };
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
    'Found orphan closing tag - extracted preceding content as thinking'
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

  // Remove OpenAI Harmony format token leakage (GPT-OSS-120B)
  result = result.replace(HARMONY_TOKEN_PATTERN, '');

  // Clean whitespace — `.trim()` is equivalent to the old /^\s+/ + /\s+$/ pair
  // and has no regex backtracking concerns on long inputs (the unbounded `\s+$`
  // tripped regexp/no-super-linear-move).
  result = result.trim().replace(/\n{3,}/g, '\n\n'); // Multiple blank lines to double

  // Strip leading stray punctuation left after truncated thinking extraction
  // (e.g., visible content starts with "., " or ", " after an unclosed tag was removed).
  // Capped at 1-2 chars + required whitespace to avoid eating leading ellipsis
  // in roleplay prose like "...she hesitated" (common dramatic pause convention).
  result = result.replace(/^[.,;]{1,2}\s+/, '');

  return result;
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
 * Try fallback extraction methods when no complete thinking tags were found.
 * Attempts unclosed tags first, then orphan closing tags.
 */
function tryFallbackExtraction(thinkingParts: string[], visibleContent: string): string {
  // Try unclosed tags (e.g. model truncation or GLM 4.5 Air glitch)
  const unclosed = extractUnclosedTag(visibleContent);
  if (unclosed !== null) {
    if (unclosed.thinkingContent.length > 0) {
      thinkingParts.push(unclosed.thinkingContent);
    }
    return unclosed.visibleContent;
  }

  // Try orphan closing tags (no opening tag, e.g. Kimi K2.5)
  const orphan = extractOrphanClosingTag(visibleContent);
  if (orphan !== null) {
    thinkingParts.push(orphan.content);
    return orphan.cleaned;
  }

  return visibleContent;
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

  const normalized = normalizeThinkingTagNamespaces(content);
  let visibleContent = normalized;

  // Pass 1 — model-specific pattern extractors.
  // Runs before the generic KNOWN_THINKING_TAGS loop so the leading block
  // is consumed before the simple tag extractors see it. Each extractor
  // targets a distinct model-version leak vocabulary; add new entries here
  // as new patterns are observed (see Chain-of-Extractors rationale on the
  // individual pattern docstrings).
  const fakeUserMessageMatch = GLM_FAKE_USER_MESSAGE_ECHO_PATTERN.exec(visibleContent);
  if (fakeUserMessageMatch !== null) {
    const extractedThinking = fakeUserMessageMatch[1].trim();
    if (extractedThinking.length > 0) {
      thinkingParts.push(extractedThinking);
    }
    // Slice rather than re-run the regex: the pattern is `^`-anchored so
    // the match is always at position 0, and `fakeUserMessageMatch[0].length`
    // is the byte count of the block to consume.
    visibleContent = visibleContent.slice(fakeUserMessageMatch[0].length);
    // "Scaffolding" (not "reasoning leak") covers both: the standard case
    // where the block contains a CoT dump, AND the empty-<message> edge case
    // where nothing was extracted but the input-format wrapper still got
    // stripped. `extractedLength: 0` paired with "reasoning leak" wording
    // was misleading in logs.
    logger.warn(
      {
        extractedLength: extractedThinking.length,
        remainingLength: visibleContent.length,
      },
      'Stripped leading fake-user-message scaffolding (GLM-4.5-Air input-format echo)'
    );
  }

  const glm47MetaMatch = GLM_47_META_PREAMBLE_PATTERN.exec(visibleContent);
  if (glm47MetaMatch !== null) {
    // Group 2 is the <analysis> body (group 1 is the preamble tag name used
    // for backreference closure matching).
    const extractedThinking = (glm47MetaMatch[2] ?? '').trim();
    if (extractedThinking.length > 0) {
      thinkingParts.push(extractedThinking);
    }
    visibleContent = visibleContent.slice(glm47MetaMatch[0].length);
    logger.warn(
      {
        extractedLength: extractedThinking.length,
        remainingLength: visibleContent.length,
        truncated: !glm47MetaMatch[0].includes('</analysis>'),
      },
      'Stripped leading meta-preamble scaffolding (GLM-4.7 user/character/analysis echo)'
    );
  }

  // Pass 2 — generic known-thinking-tag extractors.
  // Extract thinking content from ALL patterns and ALWAYS remove from visible content
  // This prevents tag leakage when responses contain multiple tag types
  //
  // Note: this loop reads from `normalized` (pre-Pass-1-strip), not from
  // `visibleContent` (post-Pass-1-strip), for match enumeration. The
  // `visibleContent.replace` below removes matched patterns from the
  // post-Pass-1 content, which is the user-visible output. Consequence:
  // if a Pass-1 `<message>` block happened to contain a Pass-2 tag
  // (`<think>`/`<understanding>`/etc.), the inner content would be added
  // to `thinkingParts` twice — once as part of the whole `<message>` block
  // in Pass 1, once as its own tag match in Pass 2. Edge case is not
  // user-visible (it only affects `showThinking` output) and would require
  // a pathological input shape. Left as-is intentionally.
  for (const pattern of THINKING_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = normalized.matchAll(pattern);
    for (const match of matches) {
      const thinkContent = match[1].trim();
      if (thinkContent.length > 0) {
        thinkingParts.push(thinkContent);
      }
    }
    pattern.lastIndex = 0;
    visibleContent = visibleContent.replace(pattern, '');
  }

  // Fallback extraction (only if no complete tags found)
  if (thinkingParts.length === 0) {
    visibleContent = tryFallbackExtraction(thinkingParts, visibleContent);
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
      `Extracted ${blockCount} thinking block(s) (${thinkingLength} chars)`
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
  const normalized = normalizeThinkingTagNamespaces(content);
  for (const pattern of THINKING_PATTERNS) {
    pattern.lastIndex = 0; // Reset regex state
    if (pattern.test(normalized)) {
      return true;
    }
  }

  // Also check for unclosed tags
  UNCLOSED_TAG_PATTERN.lastIndex = 0;
  if (UNCLOSED_TAG_PATTERN.test(normalized)) {
    return true;
  }

  // Pass-1 model-specific patterns. `extractThinkingBlocks` removes these
  // via Pass 1, so we must check them here too — otherwise
  // `DiagnosticRecorders.hasReasoningTagsInContent` would report `false` for
  // pure-GLM responses where the scaffolding is the only thinking-content
  // signal, and `/inspect` diagnostics would under-report GLM reasoning
  // occurrences.
  if (GLM_FAKE_USER_MESSAGE_ECHO_PATTERN.test(normalized)) {
    return true;
  }
  if (GLM_47_META_PREAMBLE_PATTERN.test(normalized)) {
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
    const extracted = processReasoningDetail(typedDetail);
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
    `Extracted API-level reasoning from ${parts.length} detail(s)`
  );

  return content;
}

/**
 * Process a single reasoning detail and return extracted content.
 */
function processReasoningDetail(detail: ReasoningDetail): string | null {
  switch (detail.type) {
    case 'reasoning.text':
    case 'reasoning.summary':
      return extractFromReasoningDetail(detail);

    case 'reasoning.encrypted':
      logger.debug(
        { type: detail.type, format: detail.format },
        'Found encrypted reasoning content (cannot extract)'
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
