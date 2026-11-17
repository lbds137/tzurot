/**
 * Response Artifacts Cleanup
 *
 * Defensive cleaning of AI-generated responses to handle cases where the model
 * learns patterns from conversation history or training data and adds unwanted artifacts.
 *
 * With XML-formatted prompts, models may:
 * - Echo <from id="...">Name</from> tags (speaker identification from prompt)
 * - Append stray closing tags: </message>, </module>, </current_turn>, etc.
 * - Add <message speaker="Name"> prefixes
 * - Append <reactions>...</reactions> blocks (mimicking conversation history metadata)
 * - Still occasionally add "Name:" prefixes
 *
 * Every pattern here DELETES, so each one is also a way to destroy a character's
 * legitimate reply — this product hosts AI characters and they are routinely
 * asked about the very structures these patterns hunt for. Matches inside code
 * markup are therefore left alone (`replaceOutsideCodeMarkup`), which is the
 * same discriminator the reasoning-tag extractor settled on for the same reason.
 *
 * The generic trailing-closing-tag cleanup is additionally OPENER-AWARE: a
 * trailing `</tag>` is deleted only when no matching `<tag>` appears earlier in
 * the content. Deleting the closer of a complete pair does not clean the reply,
 * it CORRUPTS it — the opener is left orphaned and ships to the reader. A
 * surviving pair is symmetric visible markup, which is cosmetic; a surviving
 * lone opener is not.
 */

import { type MessageContent } from '@tzurot/common-types/types/ai';
import { buildHeaderIdTagPattern } from '@tzurot/common-types/constants/headerIdTags';
import { replaceOutsideCodeMarkup } from '@tzurot/common-types/utils/codeSpanDetection';
import { findLeadingMentionsEnd, stripLeadingMentions } from '@tzurot/common-types/utils/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  leadingHeaderLineMatcher,
  leadingSelfHeaderLineMatcher,
  type HeaderSpoofTelemetry,
} from '../services/context/RealMessagesBuilder.js';
import {
  PROMPT_TIMESTAMP_BRACKET_PATTERN,
  PROMPT_TIMESTAMP_BRACKET_SOURCE,
} from './promptTimestampShapes.js';
import { fenceMarkerOf, nextFenceState, type FenceMarker } from './markdownFences.js';

const logger = createLogger('ResponseArtifacts');

/**
 * Minimum normalized length of a user message before we'll consider stripping
 * an echo of it from the response. Short messages ("hello", "yes", "thanks")
 * coincidentally match common response openings — a 30-char floor makes
 * false-positive matches vanishingly unlikely.
 */
const MIN_ECHO_LENGTH = 30;

/**
 * Maximum proportion of a response we're willing to strip as an echo. If the
 * response IS just the user's message (or >80% of it), the LLM effectively
 * refused to respond — stripping would leave almost nothing and hide the
 * actual failure. Better to let the broken response through so we can see it.
 */
const MAX_STRIP_RATIO = 0.8;

/**
 * One cleanup step. Takes the current content and returns it with at most one
 * artifact family removed, or unchanged when the step does not apply.
 *
 * Most steps are a single regex deletion (see {@link patternStep}); the generic
 * trailing-closer step is a function because "strip only when no matching opener
 * exists earlier" is a condition no static regex can express, and it has to be
 * evaluated against the CURRENT content on every iteration — earlier steps
 * expose trailing closers that were not trailing when the pass began.
 */
type ArtifactStep = (content: string) => string;

/**
 * Adapt a deletion regex to a step, preserving the code-markup gate and the
 * trim that every pattern has always applied.
 */
function patternStep(pattern: RegExp): ArtifactStep {
  return content => replaceOutsideCodeMarkup(content, pattern).trim();
}

/**
 * Generic trailing closing tag: catches </message>, </module>, </current_turn>,
 * etc. — the stray tags models learn to append from XML training data.
 */
const TRAILING_CLOSER_PATTERN = /<\/([a-z][a-z0-9_-]*)>\s*$/i;

/**
 * Strip a trailing closing tag ONLY when nothing earlier in the content opened
 * it. A trailing `</action>` whose `<action>` sits on the same line is half of a
 * pair the model emitted deliberately (or that an upstream pass declined to
 * unwrap); deleting just the closer orphans the opener and ships corrupted text.
 * Leaving the pair intact is the conservative direction — visible but symmetric
 * markup rather than a mangled reply.
 *
 * The opener probe is a plain scan of everything before the match: an opener
 * inside code markup still counts as "exists", which fails toward preserving
 * content, consistent with the rest of this module.
 */
function stripOrphanTrailingCloser(content: string): string {
  const match = TRAILING_CLOSER_PATTERN.exec(content);
  if (match === null) {
    return content;
  }

  // Tag name comes from the `[a-z][a-z0-9_-]*` capture, so it carries no regex
  // metacharacters (`-` is literal outside a character class) and needs no
  // escaping. The `(?:\s|>)` boundary stops `<actionable ` from counting as an
  // opener for `</action>`, and a closing tag can never match because `</` puts
  // a `/` where the pattern requires the tag's first letter.
  const opener = new RegExp(`<${match[1]}(?:\\s|>)`, 'i');
  if (opener.test(content.slice(0, match.index))) {
    return content;
  }

  return replaceOutsideCodeMarkup(content, TRAILING_CLOSER_PATTERN).trim();
}

/**
 * Self-contained metadata echoes: a short-bodied pair the model emits as a
 * whole (`<result>PersonalityName</result>`). Order is the alternation order of
 * the pattern built from it.
 */
const SELF_CONTAINED_ECHO_TAGS = [
  'result',
  'result_text',
  'parameter',
  'character',
  'name',
  'content',
] as const;

/**
 * Hallucinated tool-use scaffolding: GLM 4.5 Air (and similar models trained on
 * Anthropic/OpenAI data) wrap responses in these XML structures. Both the
 * leading-opener and leading-orphan-closer patterns are built from this list,
 * so the two can never disagree about the vocabulary.
 */
const TOOL_USE_SCAFFOLD_TAGS = [
  'function_calls',
  'function_results',
  'invoke',
  'results',
  'result',
  'result_text',
  'parameter',
  'content',
  'character',
  'name',
  'tool_calls',
  'tool_results',
  'tool_call',
  'tool_result',
] as const;

/**
 * Closing tags from the prompt's own XML structure (PromptBuilder.ts) that the
 * model echoes back. (`context` is deliberately absent: too collision-prone as
 * prose.)
 */
const PROMPT_TEMPLATE_ORPHAN_TAGS = [
  'chat_log',
  'participants',
  'protocol',
  'memory_archive',
  'contextual_references',
  'facts',
] as const;

/**
 * The deletion vocabulary of `buildArtifactPatterns` — every tag name whose
 * contents (or whose closer) this module removes.
 *
 * Exported so `wrapperTagUnwrap.ts` DERIVES its exclusion set from it instead of
 * restating the names: drift between the two silently reopens a
 * scaffolding-resurrection risk, where the unwrap pass keeps the inner text of a
 * tag family this module means to delete.
 *
 * `message` is a member via the personality-parameterized `<message speaker=...>`
 * prefix pattern and the module's generic trailing-closer handling, not via any
 * alternation literal.
 */
export const ARTIFACT_TAG_NAMES: readonly string[] = [
  ...new Set([
    'last_message',
    'from',
    ...SELF_CONTAINED_ECHO_TAGS,
    ...TOOL_USE_SCAFFOLD_TAGS,
    'received',
    'reactions',
    'message',
    ...PROMPT_TEMPLATE_ORPHAN_TAGS,
  ]),
];

/**
 * Build the ordered artifact-cleanup steps for a given personality name.
 */
function buildArtifactPatterns(personalityName: string): ArtifactStep[] {
  const escapedName = personalityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return [
    // Leading <last_message> block: model echoes prompt structure (learned from training data)
    // '<last_message>User: hello</last_message>\n\nResponse' → 'Response'
    patternStep(/^<last_message>[\s\S]*?<\/last_message>\s*/i),
    // Leading <from> tag: model echoes speaker identification from prompt
    // '<from id="abc">Kevbear</from>\n\nHello' → 'Hello'
    patternStep(/^<from\b[^>]*>[^<]*<\/from>\s*/i),
    // Self-contained hallucinated tags with short content: catches metadata echoes like
    // <result>PersonalityName</result> or <parameter name="char">Name</parameter>.
    // Max 100 chars prevents stripping tags that contain the actual response.
    // MUST come before leading opening tag pattern so matched pairs are stripped as a unit.
    patternStep(
      new RegExp(
        `^<(${SELF_CONTAINED_ECHO_TAGS.join('|')})(?:\\s[^>]*)?>[^<\\n]{0,100}<\\/\\1>\\s*`,
        'i'
      )
    ),
    // Leading hallucinated tool-use opening tags: GLM 4.5 Air (and similar models trained on
    // Anthropic/OpenAI data) wrap responses in XML tool-use structures like <function_calls>,
    // <invoke>, <results>, etc. Strip known tag families at start of content only.
    patternStep(
      new RegExp(`^<(?:${TOOL_USE_SCAFFOLD_TAGS.join('|')})(?:\\s[^>]*)?>[ \\t]*\\n?`, 'i')
    ),
    // Leading hallucinated closing tags: after inner content is stripped, orphaned closing tags
    // like </result> or </function_results> remain at the start. Strip them too.
    patternStep(new RegExp(`^<\\/(?:${TOOL_USE_SCAFFOLD_TAGS.join('|')})>[ \\t]*\\n?`, 'i')),
    // Leading <received message>...</received> block: GLM 4.5 Air echoes the user's message
    // in a hallucinated receipt structure before responding
    patternStep(/^<received(?:\s+message)?(?:\s[^>]*)?>[\s\S]*?<\/received>\s*/i),
    // Prompt template orphan closing tags: model echoes closing tags from the prompt's
    // XML structure (e.g., </chat_log> from PromptBuilder.ts). Stripped from anywhere in content
    // since they can appear mid-response, not just trailing. `facts` is a member because the
    // V-tier blocks sit in the user message, directly adjacent to the current turn — the
    // echo-probability position.
    patternStep(new RegExp(`<\\/(?:${PROMPT_TEMPLATE_ORPHAN_TAGS.join('|')})>`, 'gi')),
    // Trailing <reactions> block: LLM mimics history metadata. ReDoS: leading `\s{0,64}` is
    // bounded (an unbounded `\s*` before a literal retries at every position).
    patternStep(/\s{0,64}<reactions>[\s\S]*?<\/reactions>\s*$/i),
    // Generic trailing closing tag, opener-aware — see `stripOrphanTrailingCloser`.
    stripOrphanTrailingCloser,
    // XML message prefix: '<message speaker="Emily">Hello' → 'Hello'
    patternStep(new RegExp(`^<message\\s+speaker=["']${escapedName}["'][^>]*>\\s*`, 'i')),
    // Simple name prefix: "Emily: Hello" → "Hello". An echoed prompt
    // timestamp right after the name goes with it: "Emily: [2m ago] Hello"
    // → "Hello" — but only a prompt-timestamp bracket (see
    // promptTimestampShapes.ts). An aside after the name survives:
    // "Emily: [laughs] Anyway" → "[laughs] Anyway", pinned in
    // responseArtifacts.test.ts and responseStripSeam.test.ts. The `i` flag
    // the name match needs also folds the timestamp vocabulary's case
    // inside this step, so "Emily: [JUST NOW] hi" strips here while the
    // standalone prompt-timestamp step below stays case-exact — pinned in
    // responseArtifacts.test.ts.
    patternStep(new RegExp(`^${escapedName}:\\s*(?:${PROMPT_TIMESTAMP_BRACKET_SOURCE}\\s*)?`, 'i')),
    // Echoed prompt timestamp: "[2 hours ago] Hello" → "Hello". Only a
    // bracket whose WHOLE interior is a prompt time-formatter output (see
    // promptTimestampShapes.ts) is taken — asides like `[laughs]` and a
    // weekday+clock compound like `[Sat 18:19]` are kept, pinned in
    // responseStripSeam.test.ts.
    patternStep(PROMPT_TIMESTAMP_BRACKET_PATTERN),
  ];
}

/**
 * Apply cleanup steps iteratively until none of them changes the content.
 *
 * Every pattern here deletes, so each strip runs through
 * `replaceOutsideCodeMarkup`: a reply demonstrating `` `</chat_log>` `` is
 * byte-identical to a model that leaked one, and the demonstration is what gets
 * eaten. Position cannot decide it at this site — most of these patterns are
 * already anchored to the start or end, and a QUOTED artifact at the start or
 * end sits at the same offset a real one would, so the anchor says where, not
 * whether. (The anchors do incidentally protect the fenced case, since a leading
 * backtick means `^<tag` no longer matches; the gate is what covers the
 * unanchored patterns, where nothing else does.)
 */
function applyPatternsIteratively(
  content: string,
  patterns: ArtifactStep[],
  maxIterations: number
): { cleaned: string; strippedCount: number } {
  let cleaned = content;
  let strippedCount = 0;

  while (strippedCount < maxIterations) {
    const beforeStrip = cleaned;
    let matched = false;

    for (const step of patterns) {
      cleaned = step(cleaned);
      if (cleaned !== beforeStrip) {
        strippedCount++;
        matched = true;
        break; // Restart pattern matching from beginning
      }
    }

    if (!matched) {
      break;
    }
  }

  return { cleaned, strippedCount };
}

/**
 * Clean AI response by stripping learned artifacts
 *
 * Models learn patterns from conversation history. With XML format, they may add:
 * - Trailing </message> tags
 * - Leading <message speaker="Name"...> tags
 * - Simple "Name:" prefixes (legacy behavior)
 *
 * @param content - The AI-generated response content
 * @param personalityName - The personality name to look for
 * @returns Cleaned response content
 *
 * @example
 * ```typescript
 * stripResponseArtifacts('Hello there!</message>', 'Emily')
 * // Returns: 'Hello there!'
 * ```
 */
export function stripResponseArtifacts(content: string, personalityName: string): string {
  const patterns = buildArtifactPatterns(personalityName);
  const { cleaned, strippedCount } = applyPatternsIteratively(content, patterns, 10);

  if (strippedCount > 0) {
    const charsRemoved = content.length - cleaned.length;
    logger.warn(
      { personalityName, strippedCount, charsRemoved },
      `Stripped ${strippedCount} artifact(s) (${charsRemoved} chars) from response. ` +
        `LLM learned pattern from conversation history.`
    );
  }

  return cleaned;
}

/**
 * The id-tag shapes the platform actually emits — see
 * `@tzurot/common-types/constants/headerIdTags` for the width table and the
 * producer it derives from.
 *
 * Leading whitespace is absorbed with the tag: the platform renders a tag as
 * ` (id:xxxx)` after a name, so deleting the tag alone would leave a double
 * space in reader-visible output (`Vlad  said`) — and an echo is not bound to
 * the platform's single space, so a short run is absorbed. Bounded ({0,3})
 * rather than unbounded because an open-ended quantifier before a literal is
 * quadratic on long whitespace runs (regexp/no-super-linear-move).
 */
// Module-scope cache is safe only because the sole consumer is `String.replace`,
// which resets `lastIndex` before scanning; a `.test()`/`.exec()` loop on this
// shared `g` instance would reintroduce the hazard the builder's doc names.
const ID_TAG_PATTERN = new RegExp(`[ \\t]{0,3}${buildHeaderIdTagPattern().source}`, 'gi');

/**
 * Cut a regurgitated OTHER-speaker turn (or several) that precedes the
 * character's own restamped header: the model repeats the triggering human
 * message under that human's header, then opens its real reply under its own
 * header. The leading-header loop alone would remove only the first header
 * line and leave the echoed body as the character's speech.
 *
 * Trigger: the content (leading whitespace ignored) starts with a whole-line
 * header that is NOT the character's own. Cut point: the first line outside a
 * fenced code block where the character's own header begins; everything up to
 * and including that header line goes. Intervening other-speaker header lines
 * are cut with the rest.
 *
 * Guard — the cut is skipped (content returned unchanged, `skipped: 'blank'`
 * reported) only when the text after the self header is blank once leading
 * header-shaped lines are stripped, so a remainder that is only header lines
 * (`[Bob — t3]` and nothing else) counts as blank. There is deliberately no
 * proportion guard: the trigger is structural (a whole-line other-speaker
 * header, then the character's own header line outside a fence), and a ratio
 * check reproduced the bug for a long echoed message followed by a short reply.
 * The echoed turn is not matched against the triggering user's name either: in
 * group channels the model may echo any recent speaker. A leading other-speaker
 * header with no later self header is not a regurgitated turn and is left to the
 * loop.
 *
 * Fences: a line that is at most three spaces then a run of three or more
 * backticks or tildes opens a fence, with or without an info string (four spaces
 * or a leading tab make it indented code, not a fence). A backtick run whose
 * remainder holds a backtick is not a fence line, so an inline span at a line
 * start is text. An open fence closes only on a BARE line (nothing but whitespace
 * after the run) of the same character in a run at least as long as its opener: a
 * four-backtick fence holds a three-backtick line as content, and a fence line
 * with an info string (```` ```ts ````) inside a fence is content. A self header
 * inside a fence is not a cut point.
 *
 * Residuals:
 * - Indented code blocks are not fences: a self header indented as code is still a
 *   cut point. Pinned by 'a self header indented four spaces (an indented code block)
 *   after an echoed turn is still a cut point' in responseArtifacts.test.ts.
 * - `leadingSelfHeaderLineMatcher` matches the name as a prefix followed by a
 *   space, so a leading header from a speaker whose name starts with the
 *   character's name plus a space (character `Anna`, speaker `Anna Belle`) counts
 *   as self. The cut then does not fire: the output is what it was before the cut
 *   existed (the leading-header loop strips the leading `Anna Belle` header only).
 *   Pinned by 'a leading header whose name starts with the character name (Anna Belle
 *   for Anna) is treated as self, so the cut does not fire' in responseArtifacts.test.ts.
 * - Accepted: a model that mis-stamps its own first paragraph under another
 *   speaker's header and then restamps its own header loses that paragraph. The
 *   shape is unobserved; pinned by 'a model-written first paragraph under another speaker
 *   header is cut with the echo' in responseArtifacts.test.ts.
 *
 * `cutText` is the removed text BEFORE the self header line (the echoed
 * other-speaker turns, headers included); the self header line itself is
 * excluded so a decorated self-header preamble never reaches the telemetry.
 * `cutChars` counts the whole removal including the self header line. Cut lines
 * count only in `regurgitatedTurnCutChars`, never in `headerLinesStripped`.
 *
 * Pinned by the 'regurgitated-turn cut' cases in responseArtifacts.test.ts and,
 * composed with the real post-processor, in responseStripSeam.test.ts.
 */
function cutRegurgitatedLeadingTurns(
  content: string,
  personalityName: string
): {
  content: string;
  cutChars: number;
  cutText?: string;
  skipped?: 'blank';
  /** The leading-header strip of `content` after the cut, computed by the blank guard. */
  headerStrip?: { text: string; count: number };
} {
  const unchanged = { content, cutChars: 0 };
  const start = content.length - content.trimStart().length;
  const fromStart = content.slice(start);
  const selfHeaderMatcher = leadingSelfHeaderLineMatcher(personalityName);
  if (!leadingHeaderLineMatcher().test(fromStart) || selfHeaderMatcher.test(fromStart)) {
    return unchanged;
  }

  let fenceMarker: FenceMarker | null = null;
  let lineStart = content.indexOf('\n', start) + 1;
  while (lineStart > 0 && lineStart < content.length) {
    const line = content.slice(lineStart, content.indexOf('\n', lineStart) + 1 || undefined);
    const marker = fenceMarkerOf(line);
    if (marker !== null) {
      fenceMarker = nextFenceState(fenceMarker, marker);
    } else if (fenceMarker === null) {
      const selfHeader = selfHeaderMatcher.exec(line);
      if (selfHeader !== null) {
        const candidate = content.slice(lineStart + selfHeader[0].length);
        const headerStrip = stripLeadingHeaderLines(candidate, personalityName);
        if (headerStrip.text.trim().length === 0) {
          return { ...unchanged, skipped: 'blank' };
        }
        return {
          content: candidate,
          cutChars: content.length - candidate.length,
          cutText: content.slice(0, lineStart),
          headerStrip,
        };
      }
    }
    lineStart += line.length;
  }
  return unchanged;
}

/**
 * Strip LEADING header-shaped lines from `text`, iteratively: stacked echoed
 * headers count one per line. Two matchers per pass: the whole-line header shape
 * first, then the compound case where the model prefixes decorated preamble
 * before restamping its own header (see `leadingSelfHeaderLineMatcher`). Both
 * increment the same count, so the compound shape shows up in the existing
 * telemetry rather than hiding behind it. Each pass removes at least one
 * character, so the loop terminates.
 */
function stripLeadingHeaderLines(
  text: string,
  personalityName: string
): { text: string; count: number } {
  let remaining = text;
  let count = 0;
  const matchers = [leadingHeaderLineMatcher(), leadingSelfHeaderLineMatcher(personalityName)];
  for (;;) {
    let matchedThisPass = false;
    for (const matcher of matchers) {
      const next = remaining.replace(matcher, '');
      if (next !== remaining) {
        remaining = next;
        count += 1;
        matchedThisPass = true;
        break;
      }
    }
    if (!matchedThisPass) {
      break;
    }
  }
  return { text: remaining, count };
}

/**
 * The number of other-speaker header lines in `text` outside fenced code blocks,
 * for the `regurgitatedTurnCutTurns` telemetry: one per other-speaker turn the cut
 * removed. Fences are tracked with the same `fenceMarkerOf` / `nextFenceState` walk
 * as `cutRegurgitatedLeadingTurns`, so a header quoted inside a fence is content
 * and is not counted. A header line indented as code (4+ spaces or a tab) is still
 * counted, matching the indented-code residual of the cut.
 */
function countTurnHeaderLines(cutText: string): number {
  const headerMatcher = leadingHeaderLineMatcher();
  let fenceMarker: FenceMarker | null = null;
  let count = 0;
  for (const line of cutText.split(/\r?\n/)) {
    const marker = fenceMarkerOf(line);
    if (marker !== null) {
      fenceMarker = nextFenceState(fenceMarker, marker);
    } else if (fenceMarker === null && headerMatcher.test(line)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Share of the cut's distinct words that also appear in the user's message, for
 * the `regurgitatedTurnEchoOverlap` telemetry. 1.0 means every cut word is in the
 * user's text (a pure echo); a low value means the cut removed text the user did
 * not write, the signal that would promote a content guard. Header-shaped lines
 * are dropped first so a header never counts. Punctuation and symbols are word
 * breaks, so `there,` and `there` match; combining marks (Hebrew niqqud) stay
 * part of their word. Composed and decomposed forms of the same text (`é` as one code
 * point or as `e` plus a combining mark) match: both sides are NFC-normalized before
 * comparison. That makes this overlap more lenient than the echo strip it measures:
 * the strip (`findEchoCutIndex`) compares characters as they are, so a decomposed
 * echo the strip would not match can still score here (code-reading claim, not
 * runtime-verified). The header filter is not fence-aware: a header quoted inside a
 * fence is dropped from the word set, deliberately.
 *
 * Caveat: the overlap compares against the CURRENT user message only, so a
 * multi-turn cut or an echo of another speaker scores low while still being an
 * echo. Read the overlap only on single-turn cuts (`regurgitatedTurnCutTurns === 1`).
 *
 * Returns undefined when the cut has no words, so the telemetry field is omitted
 * rather than reporting a 0 that reads as "no overlap". Only leading Discord mentions
 * are stripped, so a mention later in the cut becomes a numeric word that matches only
 * when the user message carries the same mention.
 *
 * @internal Exported for testing
 */
export function echoWordOverlap(cut: string, userMessage: string): number | undefined {
  const headerMatcher = leadingHeaderLineMatcher();
  const bodyText = cut
    .split(/\r?\n/)
    .filter(line => !headerMatcher.test(line))
    .join('\n');
  const wordSet = (text: string): Set<string> =>
    new Set(
      normalizeForEchoMatch(text.normalize('NFC'))
        .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(w => w.length > 0)
    );
  const cutWords = wordSet(bodyText);
  if (cutWords.size === 0) {
    return undefined;
  }
  const userWords = wordSet(userMessage);
  let shared = 0;
  for (const word of cutWords) {
    if (userWords.has(word)) {
      shared += 1;
    }
  }
  return Math.round((shared / cutWords.size) * 100) / 100;
}

/**
 * Strip the real-message form's own vocabulary out of model output: a
 * regurgitated other-speaker turn ahead of the character's own header (see
 * `cutRegurgitatedLeadingTurns`), LEADING header-shaped lines (iteratively —
 * stacked echoes count per line), and platform id tags anywhere. All three are
 * echo-dynamics hygiene — every write-direction slip that survives teaches the channel the
 * header format it is meant to learn only to READ.
 *
 * Flag-gated by the caller (`ResponsePostProcessor`), never here: flag-off the
 * model never saw a header or a tag, so these strips would be pure
 * false-positive risk.
 *
 * `userMessage` (optional) is used only for the `regurgitatedTurnEchoOverlap`
 * telemetry on a fired cut; without it that field is omitted. Cut lines count
 * only in `regurgitatedTurnCutChars`, never in `headerLinesStripped`.
 * `regurgitatedTurnCutTurns` counts the other-speaker header lines the cut removed.
 * The overlap caveat in `echoWordOverlap` applies: read it only where the turn count is 1.
 */
export function stripRealMessageEchoArtifacts(
  content: string,
  telemetry: HeaderSpoofTelemetry,
  personalityName: string,
  userMessage?: MessageContent
): string {
  // Cut a regurgitated other-speaker turn before the self header, if any.
  const {
    content: afterCut,
    cutChars: regurgitatedTurnCutChars,
    cutText,
    skipped: regurgitatedTurnCutSkipped,
    headerStrip,
  } = cutRegurgitatedLeadingTurns(content, personalityName);

  // Iterative, not single-shot: a model regurgitating several recent turns
  // verbatim stacks multiple header-shaped lines at the start, and a
  // single-pass strip would leave the remaining stacked header lines in the
  // reply — the generic artifact pass's leading-bracket step does not take
  // a header-shaped bracket (it strips only prompt-timestamp interiors, see
  // promptTimestampShapes.ts). The iteration lives in `stripLeadingHeaderLines`;
  // pinned by the 'strips STACKED leading header-shaped lines iteratively,
  // counting each' case in responseArtifacts.test.ts. When the cut fired, its
  // blank guard already ran that strip over the same text, so reuse the result.
  const { text: withoutHeader, count: headerLinesStripped } =
    headerStrip ?? stripLeadingHeaderLines(afterCut, personalityName);

  // Deliberately NOT run through `replaceOutsideCodeMarkup`: the tag is
  // platform syntax with no legitimate use inside a character's reply,
  // quoted or not, and a fenced tag is exactly the echo that teaches the
  // format (same reasoning as the input-side fence decision in
  // `RealMessagesBuilder.neutralizeHeaderShapedLines`).
  let idTagsStripped = 0;
  const cleaned = withoutHeader.replace(ID_TAG_PATTERN, () => {
    idTagsStripped += 1;
    return '';
  });

  if (
    headerLinesStripped > 0 ||
    idTagsStripped > 0 ||
    regurgitatedTurnCutChars > 0 ||
    regurgitatedTurnCutSkipped !== undefined
  ) {
    // Only the number is logged, never the cut text or the user message.
    const userText = extractUserText(userMessage);
    const regurgitatedTurnEchoOverlap =
      cutText !== undefined && userText.length > 0 ? echoWordOverlap(cutText, userText) : undefined;
    const regurgitatedTurnCutTurns = cutText === undefined ? 0 : countTurnHeaderLines(cutText);
    logger.warn(
      {
        channelId: telemetry.channelId,
        requestId: telemetry.requestId,
        headerLinesStripped,
        idTagsStripped,
        ...(regurgitatedTurnCutChars > 0 && { regurgitatedTurnCutChars, regurgitatedTurnCutTurns }),
        ...(regurgitatedTurnCutSkipped !== undefined && { regurgitatedTurnCutSkipped }),
        ...(regurgitatedTurnEchoOverlap !== undefined && { regurgitatedTurnEchoOverlap }),
      },
      'Stripped real-message platform vocabulary from model output'
    );
  }

  return cleaned;
}

/**
 * Normalize text for echo-match comparison: strip every leading Discord
 * mention (user/role/channel/text-rendered), lowercase, collapse whitespace,
 * trim. Uses the shared `stripLeadingMentions` utility from common-types so
 * all mention formats stay in lockstep across the codebase. Intentionally
 * NOT Unicode-normalized — `.toLowerCase()` is a no-op for non-cased scripts
 * (Hebrew, Arabic, CJK), so comparison still works character-for-character
 * for those.
 *
 * @internal Exported for testing
 */
export function normalizeForEchoMatch(s: string): string {
  return stripLeadingMentions(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Outcome of inspecting a single character in the response during the echo walk.
 *   - `match`: a normalized character was produced and matched the expected char
 *   - `skip`: whitespace run continuation; nothing produced, keep walking
 *   - `mismatch`: produced char did not match the expected char — abort walk
 */
type StepResult = 'match' | 'skip' | 'mismatch';

/**
 * Consume one character of the response and determine whether it extends the
 * match against `expected[producedIndex]`. Factored out of `findEchoCutIndex`
 * so the walker's control flow stays readable and its cognitive complexity
 * stays within the project limit.
 */
function stepEchoChar(
  char: string,
  expected: string,
  producedIndex: number,
  lastWasSpace: boolean
): StepResult {
  if (/\s/.test(char)) {
    // Leading whitespace and whitespace-run continuations produce nothing.
    if (lastWasSpace) {
      return 'skip';
    }
    return expected[producedIndex] === ' ' ? 'match' : 'mismatch';
  }
  return expected[producedIndex] === char.toLowerCase() ? 'match' : 'mismatch';
}

/**
 * Find the index in the original response where the echoed user message ends.
 *
 * Walks the original response character-by-character, applying the same
 * normalization rules as `normalizeForEchoMatch` on the fly, verifying each
 * produced character against `userTextNormalized`, and stops when the
 * normalized length produced equals the normalized length of the user's text.
 * The returned index preserves the original casing/whitespace of everything
 * AFTER the echo.
 *
 * Returns -1 if:
 *   - the response is too short to contain the full echo, OR
 *   - any produced character doesn't match the expected character in
 *     `userTextNormalized` (i.e., the response prefix isn't actually the
 *     user's text even though it has enough chars).
 *
 * All Discord mention formats (user, role, channel, text-rendered) at the
 * leading position are skipped via `findLeadingMentionsEnd`, and multiple
 * stacked mentions are skipped too — symmetric with `normalizeForEchoMatch`
 * so boundaries line up on both sides of the comparison.
 */
function findEchoCutIndex(response: string, userTextNormalized: string): number {
  if (userTextNormalized.length === 0) {
    return -1;
  }

  // Skip leading mentions (symmetric with `normalizeForEchoMatch`).
  let i = findLeadingMentionsEnd(response, 0);

  let producedLength = 0;
  let lastWasSpace = true; // start-of-normalized is "just past trim" — no leading space

  while (i < response.length && producedLength < userTextNormalized.length) {
    const step = stepEchoChar(response[i], userTextNormalized, producedLength, lastWasSpace);
    if (step === 'mismatch') {
      return -1;
    }
    if (step === 'match') {
      producedLength++;
      lastWasSpace = /\s/.test(response[i]);
    }
    i++;
  }

  return producedLength === userTextNormalized.length ? i : -1;
}

/**
 * Extract the text body from a `MessageContent` (string or object form).
 * Returns empty string if there's no usable text — caller no-ops on that.
 */
function extractUserText(userMessage: MessageContent | undefined): string {
  if (userMessage === undefined) {
    return '';
  }
  if (typeof userMessage === 'string') {
    return userMessage;
  }
  return userMessage.content;
}

/**
 * Strip a leading verbatim echo of the user's incoming message from the AI's
 * response. Some LLMs (especially free-tier models trained on chat transcripts)
 * learned to format output with the user's message repeated as a prefix before
 * the actual response begins. Existing `stripResponseArtifacts` handles the
 * XML-wrapped variants (`<from>`, `<received message>`, etc.); this handles
 * the plain-text variant.
 *
 * Three safety guards keep false positives away from legitimate content:
 * - `MIN_ECHO_LENGTH` (30 chars): short user messages match common response
 *   openings coincidentally.
 * - Leading-position only: mid-response echoes are legitimate quoting.
 * - `MAX_STRIP_RATIO` (0.8): if stripping would eat >80% of the response, the
 *   model has failed in a different way — surface it instead of hiding it.
 *
 * Logs a warn on every strip-fire (and on the safety-abort for max-ratio) so
 * prod telemetry tells us whether the thresholds are calibrated correctly —
 * critical since the bug is not easily reproducible locally.
 *
 * @param content - The AI's response content (post-`stripResponseArtifacts`)
 * @param userMessage - The incoming user message from the generation job
 * @param personalityName - For diagnostic logging only
 * @returns Content with the leading echo stripped, or the original content unchanged
 */
export function stripUserMessageEcho(
  content: string,
  userMessage: MessageContent | undefined,
  personalityName: string
): string {
  if (content.length === 0) {
    return content;
  }

  const userText = extractUserText(userMessage);
  if (userText.length === 0) {
    return content;
  }

  const normalizedUser = normalizeForEchoMatch(userText);
  if (normalizedUser.length < MIN_ECHO_LENGTH) {
    return content;
  }

  // `findEchoCutIndex` verifies the normalized-prefix match character-by-character
  // during its walk and returns -1 on any mismatch — so a separate `startsWith`
  // check on a fully-normalized copy of `content` would be redundant work.
  const cutIndex = findEchoCutIndex(content, normalizedUser);
  if (cutIndex === -1) {
    return content;
  }

  const stripped = content.substring(cutIndex).replace(/^\s+/, '');
  // Includes the echo text AND the blank-line separator (e.g., `\n\n`) before
  // the real response body — so `MAX_STRIP_RATIO` below is measured against
  // "echo + separator" rather than the echo alone. Intentional: the separator
  // is legitimately being removed, and counting it makes the guard slightly
  // more conservative (harder to trip the strip-too-much failure mode).
  const strippedChars = content.length - stripped.length;

  // Safety guard: refuse to strip if we'd remove more than MAX_STRIP_RATIO
  // of the response. The model likely regurgitated the input instead of
  // responding — leave it visible so the real failure surfaces.
  if (strippedChars > content.length * MAX_STRIP_RATIO) {
    logger.warn(
      {
        strippedChars,
        responseLength: content.length,
        personalityName,
      },
      'Skipping user-message-echo strip — would remove >80% of response'
    );
    return content;
  }

  logger.warn(
    {
      userMessageLength: userText.length,
      strippedChars,
      originalResponseLength: content.length,
      personalityName,
    },
    'Stripped leading user-message echo — model learned echo pattern'
  );
  return stripped;
}
