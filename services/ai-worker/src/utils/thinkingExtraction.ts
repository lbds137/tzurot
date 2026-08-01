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

import {
  isInsideCodeSpan,
  replaceOutsideCodeMarkup,
} from '@tzurot/common-types/utils/codeSpanDetection';
import { createLogger } from '@tzurot/common-types/utils/logger';

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
 *
 * Exported so the quoted-delimiter guard suite can enumerate the vocabulary
 * rather than restate it. Every name added here widens the surface on which a
 * reply that merely QUOTES the tag could be mistaken for one that uses it, so
 * the guard must grow with the list automatically — a hand-maintained copy in
 * the tests would drift on exactly the revision that needed it.
 */
export const KNOWN_THINKING_TAGS = [
  'think', // DeepSeek R1, Qwen QwQ, GLM-4.x, Kimi K2
  'thinking', // Claude prompted, some distilled models
  'ant_thinking', // Legacy Anthropic format
  'reasoning', // Some fine-tuned models
  'thought', // Legacy fine-tunes (Llama, Mistral)
  'reflection', // Reflection AI
  'scratchpad', // Legacy research models
  'character_analysis', // GLM 4.5 Air internal chain-of-thought
  'understanding', // GLM 4.5 Air (reasoning=medium, req deb8b063)
] as const;

/**
 * GLM-4.5-Air fake-user-message-echo pattern.
 *
 * Observed in production (req b533e288-fb07-46c0-a5e2-a0f78883e63e): with
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
 * loop. Council (Gemini 3.1 Pro Preview) recommended the
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
 * Standalone `<from_id>` echo — bare variant of the 4.5-Air leak.
 *
 * Observed in production (Lilith persona, image-vision context,
 * `z-ai/glm-4.7 • 📍 auto`). GLM-4.7 emitted just
 * `<from_id>UUID</from_id>` followed by the in-character response, without
 * the rest of the GLM-4.5-Air vocabulary (`<user>`, `<message>`). The
 * `GLM_FAKE_USER_MESSAGE_ECHO_PATTERN` above requires the full sequence to
 * match and silently passes through this bare variant — leaking the
 * `<from_id>UUID</from_id>` tag into the user-facing Discord output.
 *
 * Source of the leak: prompt scaffolding includes `<message from="..."
 * from_id="UUID" role="..."...>...</message>`. The model treats `from_id`
 * as a standalone element rather than an attribute and echoes it as
 * leading scaffolding. `HardcodedConstraints.ts` already tells the model
 * not to do this; GLM-4.7 ignores the constraint inconsistently.
 *
 * Safety: same UUID-format anchor as the 4.5-Air pattern. A real response
 * won't statistically start with `<from_id>UUID-shaped-text</from_id>`
 * because UUIDs are not natural prose. Strip without side effects.
 *
 * Order in Pass 1: must run AFTER `GLM_FAKE_USER_MESSAGE_ECHO_PATTERN`. If
 * the 4.5-Air full-sequence is present, the leading `<from_id>` is part of
 * that block and should be consumed by the more-specific extractor (which
 * also captures the `<message>` body as reasoning). Only when the
 * 4.5-Air pattern doesn't match (because `<user>`/`<message>` follow-up is
 * absent) does this fallback fire on the residual bare `<from_id>`.
 *
 * No reasoning content — `from_id` is just a UUID, not a CoT block. Strip
 * silently without contributing to `thinkingParts`.
 *
 * Deletion plan: same as the other GLM patterns — once OpenRouter's
 * reasoning middleware polyfills this leak shape upstream, remove this
 * extractor. Removal trigger: a production log sample showing GLM-4.7
 * responses NO LONGER include a leading `<from_id>UUID</from_id>` block
 * for several days running. File with the raw API response as evidence
 * before removing.
 */
const STANDALONE_FROM_ID_ECHO_PATTERN =
  /^\s*<from_id>[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}<\/from_id>\s*/;

/**
 * GLM-4.7 meta-preamble pattern.
 *
 * Observed in production (req 9b2aa0f3-d659-4f00-95f4-36da3a9b40f3): with
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
 * Interaction with `normalizeThinkingTagNamespaces` and Pass 2: `user`,
 * `character`, and `analysis` must NOT appear in `KNOWN_THINKING_TAGS`.
 * Adding bare `analysis` to that list (natural-seeming given
 * `character_analysis` is already there) would cause Pass 2 to double-
 * extract the `<analysis>` body into `thinkingParts` from `normalized`
 * (which still holds the original content). Not user-visible since Pass 1
 * already strips it from `visibleContent`, but inflates thinking output.
 * If `KNOWN_THINKING_TAGS` is ever extended with an overlapping name,
 * re-verify.
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
 * Pass-1 strip helper for the standalone `<from_id>` echo. Extracted from
 * `extractThinkingBlocks` to keep that function under the cognitive-complexity
 * limit — a Pass-1 entry that doesn't capture content (the bare `<from_id>`
 * carries no reasoning) is cleaner as a separate one-liner caller.
 */
function stripStandaloneFromId(content: string): string {
  const match = STANDALONE_FROM_ID_ECHO_PATTERN.exec(content);
  if (match === null) {
    return content;
  }
  const stripped = content.slice(match[0].length);
  logger.warn(
    { remainingLength: stripped.length },
    'Stripped leading standalone <from_id> scaffolding (GLM-4.7 bare-from-id echo)'
  );
  return stripped;
}

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
 * Pattern to match an unclosed thinking tag at the HEAD of a response (model
 * truncation or errors). Only used as a fallback when no complete tags are found.
 *
 * The `^\s*` anchor is load-bearing, and matches the convention every Pass-1
 * pattern above already relies on: a genuine unclosed reasoning block is a
 * PREFIX phenomenon — the model opened its reasoning and never closed it, so
 * nothing precedes the tag. A tag appearing after real prose is, by definition,
 * the model TALKING about the tag. Without the anchor, a reply quoting
 * `<thinking>` had everything from that point to end-of-string consumed as
 * reasoning, truncating the user-visible message mid-sentence.
 */
const HEAD_UNCLOSED_TAG_PATTERN = new RegExp(`^\\s*<(${TAG_ALT})>([\\s\\S]*)$`, 'i');

/**
 * Pattern to detect an opening thinking tag anywhere in the content.
 *
 * Diagnostic only — never used to strip. It reports the case the head anchor
 * above declines to act on, so a genuine mid-response unclosed block (not yet
 * observed in production, but not impossible) would surface in logs instead of
 * silently rendering its raw tag.
 */
const ANY_OPENING_TAG_PATTERN = new RegExp(`<(${TAG_ALT})>`, 'gi');

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
 * Pattern matching a thinking closing tag anywhere in the content.
 *
 * Serves both consumers of orphan closing tags: `extractOrphanClosingTag`
 * enumerates candidates with it, and `cleanupVisibleContent` removes whatever
 * survives. Both skip occurrences inside code markup — see `isInsideCodeSpan`.
 */
const CLOSING_TAG_PATTERN = new RegExp(`<\\/(${TAG_ALT})>`, 'gi');

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

/**
 * Strip a head-anchored unclosed thinking tag, keeping its body visible.
 *
 * An unclosed opening tag means the model opened a reasoning block and never
 * closed it — either a glitch (GLM 4.5 Air) or truncation. In both cases the
 * body is the response the user is waiting for, so the tag is removed and
 * everything after it stays visible rather than being filed as reasoning.
 * Only the leading tag is removed: a later occurrence is prose the model wrote
 * and must survive verbatim.
 *
 * @returns Content with the leading tag removed, or null when no head tag matched
 */
function stripHeadUnclosedTag(visibleContent: string): string | null {
  const match = HEAD_UNCLOSED_TAG_PATTERN.exec(visibleContent);
  if (match === null) {
    return null;
  }

  const body = match[2];
  if (body.trim().length === 0) {
    return null;
  }

  logger.warn(
    { tagName: match[1], contentLength: body.length },
    'Found unclosed thinking tag at start of response — stripping tag, keeping content visible'
  );

  return body;
}

/**
 * Report an opening thinking tag that the head anchor declined to act on.
 *
 * Every unclosed-tag case observed in production has been head-anchored, so a
 * mid-response one is expected to be a quotation. This log exists so that
 * assumption is falsifiable: if a model genuinely opens reasoning mid-response,
 * it shows up here instead of silently rendering a raw tag to the user.
 */
function logDeclinedMidResponseTag(visibleContent: string): void {
  ANY_OPENING_TAG_PATTERN.lastIndex = 0;
  const match = ANY_OPENING_TAG_PATTERN.exec(visibleContent);
  if (match === null) {
    return;
  }

  logger.info(
    {
      tagName: match[1],
      tagOffset: match.index,
      quoted: isInsideCodeSpan(visibleContent, match.index),
      contentLength: visibleContent.length,
    },
    'Opening thinking tag mid-response — treated as quoted prose, left visible'
  );
}

/**
 * Extract content from orphan closing tags (no opening tag).
 *
 * Some models emit reasoning with no opening tag and simply terminate it with
 * `</think>`, so the closing tag sits mid-line, mid-text — positionally
 * identical to a reply that merely MENTIONS the tag. Code markup is the only
 * signal that separates the two, so candidates inside a backtick span or fenced
 * block are skipped and the next one is considered.
 *
 * This path is LIVE, not legacy. Kimi K2.5 is where the shape was first seen,
 * but a prod log sweep found the current emitter to be `glm-4.5-air`, an
 * in-rotation free-tier model: six extractions across 374 generations, bodies of
 * 1256–2098 chars, three of them followed by healthy visible output. Deleting
 * this path would put 1–2 KB of raw reasoning in front of those replies.
 *
 * The consequence for the quoted-syntax audit: because the path must stay, so
 * must its ambiguity. An UNFENCED mid-prose `</think>` ("it just prints </think>
 * before answering") is still consumed, and no discriminator can separate that
 * from the real thing — both are mid-line, mid-text prose. That gap is a
 * permanent known limit rather than something a future heuristic closes.
 *
 * @returns Extracted content and cleaned visible content, or null if no match
 */
function extractOrphanClosingTag(
  visibleContent: string
): { content: string; cleaned: string } | null {
  CLOSING_TAG_PATTERN.lastIndex = 0;
  for (const match of visibleContent.matchAll(CLOSING_TAG_PATTERN)) {
    const tagOffset = match.index;
    if (isInsideCodeSpan(visibleContent, tagOffset)) {
      continue;
    }

    const content = visibleContent.slice(0, tagOffset).trim();
    if (content.length < MIN_ORPHAN_CONTENT_LENGTH) {
      // Bail entirely rather than trying the next candidate. Too little text
      // before the FIRST real closing tag means this is stray garbage (the
      // chimera stutter shape), not reasoning — and the right handler for that
      // is the blanket cleanup pass, which strips the tag and keeps the text.
      // Searching on would find a later tag and misfile everything before it,
      // including the garbage, as thinking.
      return null;
    }

    logger.warn(
      { tagName: match[1], contentLength: content.length },
      'Found orphan closing tag - extracted preceding content as thinking'
    );

    return { content, cleaned: visibleContent.slice(tagOffset + match[0].length) };
  }

  return null;
}

/**
 * Report that the chimera-stutter pass actually stripped something.
 *
 * The pattern targets one merged model's quirk (`tng-r1t-chimera`) but runs on
 * every response, so its cost is model-independent while its benefit is not —
 * and that model left the OpenRouter free tier. Whether the pass still earns its
 * keep is an evidence question, and until this line existed the pass stripped
 * silently, so there was nothing to answer it with.
 *
 * Permanent observability (`feat`), not scaffolding — do not sweep it as stale
 * instrumentation. It fires only on a real strip, which is expected to be rare;
 * a run of zero over a release is the evidence that retires the pattern, and any
 * occurrence names the model that still justifies it.
 */
function logChimeraArtifactStripped(before: string, after: string): void {
  logger.info(
    { strippedChars: before.length - after.length, contentLength: before.length },
    'Chimera stutter artifact stripped from response'
  );
}

/**
 * Clean up visible content after extraction.
 */
function cleanupVisibleContent(content: string): string {
  // Clean chimera artifacts — skipping quoted ones, same as the orphan pass
  // below. This pattern eats a whole `token. </tag>` fragment, so a quoted
  // example starting a line loses its text and leaves a dangling backtick.
  // The stutter it targets is one merged model's quirk; the false positive
  // lands on every model, which is why the gate is worth more than the pass.
  // Test the CLOSING TAG's position, not the match start: this pattern's match
  // begins at the preceding newline, which sits outside the backtick span the
  // quoted tag lives in, so gating on the match start would never fire.
  let result = replaceOutsideCodeMarkup(content, CHIMERA_ARTIFACT_PATTERN, match =>
    match.lastIndexOf('</')
  );
  if (result !== content) {
    logChimeraArtifactStripped(content, result);
  }

  // Remove remaining orphan closing tags — except ones the model quoted inside
  // code markup, where deleting the tag would corrupt the quotation it wrote.
  result = replaceOutsideCodeMarkup(result, CLOSING_TAG_PATTERN);

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
  // Try a head-anchored unclosed tag (model truncation or GLM 4.5 Air glitch)
  const stripped = stripHeadUnclosedTag(visibleContent);
  if (stripped !== null) {
    return stripped;
  }

  logDeclinedMidResponseTag(visibleContent);

  // Try orphan closing tags (no opening tag, e.g. Kimi K2.5)
  const orphan = extractOrphanClosingTag(visibleContent);
  if (orphan !== null) {
    thinkingParts.push(orphan.content);
    return orphan.cleaned;
  }

  return visibleContent;
}

/**
 * Pass 2 — extract every complete `<tag>…</tag>` pair that is not quoted.
 *
 * A quoted complete pair is the most natural way a reply demonstrates the
 * syntax (`` `<think>like this</think>` ``), and it needs the same code-markup
 * gate as the fallback paths — otherwise the example's body is filed as
 * reasoning and vanishes from the reply.
 *
 * The gate is applied TWICE, against different strings, which is why this reads
 * as two passes rather than one: enumeration indexes into `normalized`, while
 * removal re-matches over `visibleContent` (already shortened by Pass 1), so an
 * offset from one does not address the other.
 *
 * Skipping (rather than bailing) means a reply that both reasons AND shows an
 * example still yields its real reasoning.
 *
 * @param thinkingParts - Accumulator, appended in place
 * @returns `visibleContent` with the unquoted pairs removed
 */
function extractCompleteTagPairs(
  normalized: string,
  visibleContent: string,
  thinkingParts: string[]
): string {
  let remaining = visibleContent;

  for (const pattern of THINKING_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of normalized.matchAll(pattern)) {
      const thinkContent = match[1].trim();
      if (!isInsideCodeSpan(normalized, match.index) && thinkContent.length > 0) {
        thinkingParts.push(thinkContent);
      }
    }

    pattern.lastIndex = 0;
    remaining = replaceOutsideCodeMarkup(remaining, pattern);
  }

  return remaining;
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

  visibleContent = stripStandaloneFromId(visibleContent);

  const glm47MetaMatch = GLM_47_META_PREAMBLE_PATTERN.exec(visibleContent);
  if (glm47MetaMatch !== null) {
    // Group 2 is the <analysis> body (group 1 is the preamble tag name used
    // for backreference closure matching).
    const extractedThinking = glm47MetaMatch[2].trim();
    if (extractedThinking.length > 0) {
      thinkingParts.push(extractedThinking);
    }
    visibleContent = visibleContent.slice(glm47MetaMatch[0].length);
    logger.warn(
      {
        extractedLength: extractedThinking.length,
        remainingLength: visibleContent.length,
        // Case-insensitive check mirrors the outer regex's `/i` flag. A plain
        // `.includes('</analysis>')` would miss uppercased closing tags (e.g.
        // `</ANALYSIS>`) and falsely log `truncated: true` even when the model
        // successfully closed the block.
        truncated: !/<\/analysis>/i.test(glm47MetaMatch[0]),
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
  //
  // The same two-string split bounds the quote gate inside: it is evaluated
  // against `normalized` when collecting and against the post-Pass-1 string
  // when removing, so where a Pass-1 extractor stripped a head prefix the two
  // scans could in principle disagree about whether an occurrence is quoted.
  // Same blast radius as above — only `thinkingParts` bucketing, never
  // `visibleContent` — because the removal side is the one the reply sees and
  // it always scans the string it is about to modify.
  visibleContent = extractCompleteTagPairs(normalized, visibleContent, thinkingParts);

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
    for (const match of normalized.matchAll(pattern)) {
      // Mirrors the extractor's code-markup gate: a quoted pair is an example,
      // and reporting it here would tell /inspect a reply contains reasoning
      // that the extractor deliberately left alone.
      if (!isInsideCodeSpan(normalized, match.index)) {
        return true;
      }
    }
  }

  // Also check for a head-anchored unclosed tag. Mirrors the extractor's own
  // anchor so diagnostics don't report reasoning for a reply that merely quotes
  // a tag mid-prose — `hasReasoningTagsInContent` would otherwise over-report.
  if (HEAD_UNCLOSED_TAG_PATTERN.test(normalized)) {
    return true;
  }

  // Pass-1 model-specific patterns. `extractThinkingBlocks` removes these
  // via Pass 1, so we must check them here too — otherwise
  // `DiagnosticRecorders.hasReasoningTagsInContent` would report `false` for
  // pure-GLM responses where the scaffolding is the only thinking-content
  // signal, and `/inspect` diagnostics would under-report GLM reasoning
  // occurrences.
  if (STANDALONE_FROM_ID_ECHO_PATTERN.test(normalized)) {
    return true;
  }
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
