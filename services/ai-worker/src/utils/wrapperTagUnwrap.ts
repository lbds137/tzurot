/**
 * Unknown Wrapper-Tag Unwrapping
 *
 * Free-tier models (observed: GLM 4.5 Air) invent content-shaped XML markup and
 * wrap parts of an in-character reply in it — a persona's stage direction comes
 * back as a literal `<action>She walks away.</action>` line in Discord. The tag
 * vocabulary is invented per-response, so a blocklist structurally loses: the
 * next response uses `<gesture>`, `<emote>`, `<narration>`.
 *
 * This module therefore unwraps GENERICALLY, in three modes: any lowercase tag
 * pair that wraps an entire message, an entire line, or a contiguous SPAN of
 * whole lines — and is not in {@link WRAPPER_UNWRAP_EXCLUDED_TAGS} — has its
 * delimiters removed and its inner text kept VERBATIM. Unwrap is not deletion
 * and not reformatting — no italicizing, no content loss.
 *
 * The span mode exists because the other two both decline a multi-line wrapped
 * block embedded in a longer reply: the whole-message mode because the content
 * does not start with the tag, the line mode because the opener's line carries
 * no closer. Without it those literal tags ship to the reader.
 *
 * Why an exclusion set rather than a pure blocklist-free design: two other
 * passes in this pipeline own specific tag vocabularies, and both would be
 * broken by unwrapping.
 * - Thinking tags (`thinkingExtraction.ts`) are EXTRACTED upstream — their
 *   inner text is reasoning, routed to spoiler output, never to the reply.
 * - Artifact tags (`responseArtifacts.ts`) are deliberately DELETED downstream —
 *   their inner text is prompt-scaffolding echo that must not survive.
 * Unwrapping either would preserve content another handler means to remove, so
 * both vocabularies are excluded here and left to their owners.
 *
 * Conservative by construction. Three guards keep it away from legitimate
 * content, and each fails toward "leave the text alone":
 * 1. Whole-unit only — a tag pair sharing a line with other text is untouched,
 *    and a span's two delimiters must each sit alone on their own line.
 * 2. Code markup — a reply that DEMONSTRATES `<action>` syntax inside backticks
 *    or a fence is left byte-identical (same discriminator the reasoning-tag
 *    extractor settled on, for the same reason: this product hosts AI
 *    characters and they routinely discuss markup).
 * 3. XML documents — if the inner text carries tag pairs of a DIFFERENT name,
 *    the model is emitting structured XML rather than a stray wrapper, and it
 *    survives intact.
 */

import { isInsideCodeSpan } from '@tzurot/common-types/utils/codeSpanDetection';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ARTIFACT_TAG_NAMES } from './responseArtifacts.js';
import { KNOWN_THINKING_TAGS } from './thinkingExtraction.js';

const logger = createLogger('wrapper-tag-unwrap');

/**
 * Tag names this pass must never unwrap, because another pass in the pipeline
 * owns them and unwrapping would defeat that pass.
 *
 * Two groups, both imported rather than restated, so a tag added for a new model
 * revision or a new prompt block inherits the exclusion instead of arriving
 * unguarded:
 * - `KNOWN_THINKING_TAGS` — the reasoning vocabulary.
 * - `ARTIFACT_TAG_NAMES` — the `responseArtifacts.ts` deletion vocabulary, every
 *   tag family named by `buildArtifactPatterns` there. Those patterns DELETE
 *   their contents; keeping the contents by unwrapping first would resurrect
 *   prompt-scaffolding echo. It includes the `PromptBuilder` prompt-template
 *   orphan-closer vocabulary, since those closers are part of that pattern list.
 *
 * Exported so the guard suite can enumerate the vocabulary rather than restate
 * it; a hand-maintained copy in the tests would drift on exactly the revision
 * that needed it.
 */
export const WRAPPER_UNWRAP_EXCLUDED_TAGS: readonly string[] = [
  // Reasoning vocabulary — extracted upstream by `extractThinkingBlocks`.
  ...KNOWN_THINKING_TAGS,
  // Artifact vocabulary — deleted downstream by `stripResponseArtifacts`.
  ...ARTIFACT_TAG_NAMES,
];

const EXCLUDED_TAG_SET: ReadonlySet<string> = new Set(WRAPPER_UNWRAP_EXCLUDED_TAGS);

/**
 * Tag-name shape. Lowercase-only, matching the generic trailing-closing-tag
 * pattern in `responseArtifacts.ts` — the models that emit these wrappers emit
 * them lowercase, and requiring lowercase keeps prose like `<Bob>` (a
 * name-in-angle-brackets convention some characters use) out of scope.
 */
const TAG_NAME = '[a-z][a-z0-9_-]*';

/** Opening tag anchored at the start of a candidate, with optional attributes. */
const OPENING_TAG_PATTERN = new RegExp(`^<(${TAG_NAME})(?:\\s[^>]*)?>`);

/**
 * A span's delimiters: a tag ALONE on its (trimmed) line, nothing else on it.
 *
 * The trailing `$` is what separates the span mode from the line-level sweep. A
 * line carrying both delimiters is a whole-line wrap and belongs to that sweep;
 * a line carrying an opener plus prose is the partial-wrap shape both modes
 * decline.
 */
const SPAN_OPENER_PATTERN = new RegExp(`^<(${TAG_NAME})(?:\\s[^>]*)?>$`);
const SPAN_CLOSER_PATTERN = new RegExp(`^<\\/(${TAG_NAME})>$`);

/**
 * Any complete tag pair, capturing both names. Used by the XML-document guard:
 * a pair whose names differ from the wrapper's means the inner text is a
 * structured document, not stray markup around prose. Opener and closer names
 * are captured separately (rather than backreferenced) so a MISMATCHED pair —
 * which is even less like a stray wrapper — also trips the guard.
 */
const ANY_TAG_PAIR_PATTERN = new RegExp(
  `<(${TAG_NAME})(?:\\s[^>]*)?>[\\s\\S]*?<\\/(${TAG_NAME})>`,
  'g'
);

/**
 * Passes to run. Each pass removes at most one layer, so a double-wrap
 * (`<action><action>x</action></action>`) needs two. Bounded rather than
 * looped-to-fixpoint because the input is adversarial model output and this
 * runs on every response; three layers is already far past anything observed.
 */
const MAX_PASSES = 3;

/**
 * Whether the inner text is a structured XML document rather than prose.
 *
 * Pairs of the SAME name as the wrapper are exempt: they are exactly the
 * double-wrap shape the pass bound exists to resolve, and blocking on them
 * would leave the outer layer visible. Pairs of any other name mean a persona
 * legitimately emitted markup, which must survive byte-identical.
 */
function innerLooksLikeXmlDocument(inner: string, wrapperTag: string): boolean {
  ANY_TAG_PAIR_PATTERN.lastIndex = 0;
  for (const match of inner.matchAll(ANY_TAG_PAIR_PATTERN)) {
    if (match[1] !== wrapperTag || match[2] !== wrapperTag) {
      return true;
    }
  }
  return false;
}

/**
 * Locate the closing tag that MATCHES the opener at the start of `text`.
 *
 * Depth-counting rather than a `</tag>$`-anchored regex, because the anchored
 * form silently picks the LAST closer on the line. On
 * `<action>a</action> and <action>b</action>` that yields an "inner" of
 * `a</action> and <action>b` — a partial-wrap line the pass is supposed to
 * decline. Depth counting reports the first closer instead, which is not at the
 * end, so the caller correctly declines.
 *
 * @returns Span of the matching closer, or null when it never closes
 */
function findMatchingCloser(
  text: string,
  tag: string,
  searchFrom: number
): { start: number; end: number } | null {
  const tagPattern = new RegExp(`<(\\/?)${tag}(?:\\s[^>]*)?>`, 'g');
  tagPattern.lastIndex = searchFrom;

  let depth = 1;
  let match = tagPattern.exec(text);
  while (match !== null) {
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) {
      return { start: match.index, end: match.index + match[0].length };
    }
    match = tagPattern.exec(text);
  }

  return null;
}

/**
 * Inner text of a wrapper tag pair that spans the WHOLE of `candidate`, or null.
 *
 * `candidate` is expected pre-trimmed. Every rejection path here is a
 * conservatism decision, in order: unknown-shape opener, an owned vocabulary,
 * an unclosed or partial wrap, an empty body, and a structured document.
 */
function extractWholeWrap(candidate: string): { tag: string; inner: string } | null {
  const opening = OPENING_TAG_PATTERN.exec(candidate);
  if (opening === null) {
    return null;
  }

  const tag = opening[1];
  if (EXCLUDED_TAG_SET.has(tag)) {
    return null;
  }

  const closer = findMatchingCloser(candidate, tag, opening[0].length);
  // A closer short of the end means the pair wraps only PART of the candidate —
  // the deliberate false-positive conservatism: `text <action>x</action> more`
  // is prose that mentions markup as often as it is a stray wrapper.
  if (closer?.end !== candidate.length) {
    return null;
  }

  const inner = candidate.slice(opening[0].length, closer.start);
  if (inner.trim().length === 0) {
    return null;
  }

  if (innerLooksLikeXmlDocument(inner, tag)) {
    return null;
  }

  return { tag, inner: inner.trim() };
}

/**
 * Unwrap a tag pair that wraps the entire message.
 *
 * No code-markup probe here, deliberately: the opening `<` sits at the very
 * start of the trimmed content, and a code span or fence would have to OPEN
 * before it — but everything before it is whitespace, so `isInsideCodeSpan`
 * can never be true at that offset. The fenced-example case self-declines
 * instead: a message that is one ``` block starts with a backtick, which
 * `OPENING_TAG_PATTERN` does not match. (The line-level sweep genuinely needs
 * the probe — a line can sit inside a fence opened lines earlier.)
 *
 * @returns The unwrapped content, or null when nothing applied
 */
function unwrapWholeMessage(content: string, unwrappedTags: string[]): string | null {
  const wrap = extractWholeWrap(content.trim());
  if (wrap === null) {
    return null;
  }

  unwrappedTags.push(wrap.tag);
  return wrap.inner;
}

/**
 * Index of the line whose closer matches the span opened at `openIndex`, or
 * null when the span never closes.
 *
 * Depth-counted over opener-alone and closer-alone lines of the SAME name, for
 * the same reason `findMatchingCloser` counts depth within a line: a nested
 * same-name span must resolve outermost-first, leaving the layer beneath it to
 * the next pass, rather than closing the outer span on the inner closer.
 */
function findSpanCloserLine(lines: string[], openIndex: number, tag: string): number | null {
  let depth = 1;

  for (let i = openIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (SPAN_OPENER_PATTERN.exec(trimmed)?.[1] === tag) {
      depth++;
    } else if (SPAN_CLOSER_PATTERN.exec(trimmed)?.[1] === tag) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return null;
}

/**
 * The span opened by `lines[openIndex]`, or null when that line does not open
 * one that qualifies.
 *
 * Every rejection path the other two modes carry, in the same order and for the
 * same reasons: unknown-shape opener, an owned vocabulary, code markup, an
 * unclosed span, an empty body, and a structured document. The code-markup
 * probe is taken at the opener's own offset in the FULL content — a span
 * demonstrated inside a fence opened lines earlier must stay byte-identical,
 * which is exactly the case the whole-message mode can skip and the line-level
 * sweep cannot.
 *
 * @param lineStart - Offset of `lines[openIndex]` within `content`
 * @returns The tag name and the closer's line index, or null
 */
function extractSpanAt(
  lines: string[],
  openIndex: number,
  lineStart: number,
  content: string
): { tag: string; end: number } | null {
  const line = lines[openIndex];
  const opening = SPAN_OPENER_PATTERN.exec(line.trim());
  if (opening === null) {
    return null;
  }

  const tag = opening[1];
  if (EXCLUDED_TAG_SET.has(tag)) {
    return null;
  }

  const indent = line.length - line.trimStart().length;
  if (isInsideCodeSpan(content, lineStart + indent)) {
    return null;
  }

  const end = findSpanCloserLine(lines, openIndex, tag);
  if (end === null) {
    return null;
  }

  const inner = lines.slice(openIndex + 1, end).join('\n');
  if (inner.trim().length === 0) {
    return null;
  }

  if (innerLooksLikeXmlDocument(inner, tag)) {
    return null;
  }

  return { tag, end };
}

/**
 * Unwrap contiguous line-SPANS: an opener alone on its line, a matching closer
 * alone on a later line, and the block of lines between them.
 *
 * Unwrapping DELETES the two delimiter lines outright, line breaks included;
 * the inner lines keep their own text, blank lines, and indentation verbatim.
 * That is the only shape "remove the delimiters, keep the content" can take
 * when the delimiters occupy whole lines of their own.
 *
 * @returns The content with qualifying spans unwrapped (unchanged string when none did)
 */
function unwrapSpans(content: string, unwrappedTags: string[]): string {
  const lines = content.split('\n');
  let offset = 0;
  const lineStarts = lines.map(line => {
    const start = offset;
    offset += line.length + 1; // +1 for the '\n' consumed by the split
    return start;
  });

  const kept: string[] = [];
  let unwrapped = false;

  for (let i = 0; i < lines.length; i++) {
    const span = extractSpanAt(lines, i, lineStarts[i], content);
    if (span === null) {
      kept.push(lines[i]);
      continue;
    }

    unwrappedTags.push(span.tag);
    unwrapped = true;
    // Inner lines verbatim; the opener line and `lines[span.end]` are dropped.
    for (let inner = i + 1; inner < span.end; inner++) {
      kept.push(lines[inner]);
    }
    i = span.end;
  }

  return unwrapped ? kept.join('\n') : content;
}

/**
 * Unwrap tag pairs that wrap an entire line, leaving every other line alone.
 *
 * This is the shape the production incident took: a Discord roleplay reply
 * where dialogue lines are plain and the stage direction arrived as its own
 * `<action>…</action>` line.
 *
 * @returns The content with qualifying lines unwrapped (unchanged string when none did)
 */
function unwrapLines(content: string, unwrappedTags: string[]): string {
  const lines = content.split('\n');
  let lineStart = 0;

  const rewritten = lines.map(line => {
    const start = lineStart;
    lineStart += line.length + 1; // +1 for the '\n' consumed by the split

    const indent = line.length - line.trimStart().length;
    const wrap = extractWholeWrap(line.trim());
    if (wrap === null) {
      return line;
    }

    if (isInsideCodeSpan(content, start + indent)) {
      return line;
    }

    unwrappedTags.push(wrap.tag);
    return line.slice(0, indent) + wrap.inner;
  });

  return rewritten.join('\n');
}

/**
 * Remove invented content-shaped wrapper tags from a model response.
 *
 * Modes are tried widest-first — whole message, then line spans, then single
 * lines — and a pass that unwraps anything stops there, because the layer
 * beneath it may qualify for a wider mode and gets the next pass.
 *
 * @param content - The response content (post thinking-extraction)
 * @returns The content with unknown wrapper tags removed, and the tag names removed
 *
 * @example
 * ```typescript
 * unwrapUnknownWrapperTags('"Hi."\n<action>She waves.</action>');
 * // { content: '"Hi."\nShe waves.', unwrappedTags: ['action'] }
 * ```
 */
export function unwrapUnknownWrapperTags(content: string): {
  content: string;
  unwrappedTags: string[];
} {
  const unwrappedTags: string[] = [];
  let current = content;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const whole = unwrapWholeMessage(current, unwrappedTags);
    if (whole !== null) {
      current = whole;
      continue;
    }

    const spanSwept = unwrapSpans(current, unwrappedTags);
    if (spanSwept !== current) {
      current = spanSwept;
      continue;
    }

    const lineSwept = unwrapLines(current, unwrappedTags);
    if (lineSwept === current) {
      break;
    }
    current = lineSwept;
  }

  if (unwrappedTags.length > 0) {
    // Tag names and lengths only — response text is user content and never logged.
    logger.info(
      { tags: unwrappedTags, contentLength: current.length },
      'Unwrapped unknown wrapper tags from response'
    );
  }

  return { content: current, unwrappedTags };
}
