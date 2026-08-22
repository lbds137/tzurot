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
import { replaceOutsideCodeMarkup } from '@tzurot/common-types/utils/codeSpanDetection';
import { findLeadingMentionsEnd, stripLeadingMentions } from '@tzurot/common-types/utils/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  leadingHeaderLineMatcher,
  type HeaderSpoofTelemetry,
} from '../services/context/RealMessagesBuilder.js';

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
    // Trailing <reactions> block: LLM mimics history metadata. ReDoS: leading `\s{0,64}` bounded (unbounded `\s*` before literal retries at every position).
    patternStep(/\s{0,64}<reactions>[\s\S]*?<\/reactions>\s*$/i),
    // Generic trailing closing tag, opener-aware — see `stripOrphanTrailingCloser`.
    stripOrphanTrailingCloser,
    // XML message prefix: '<message speaker="Emily">Hello' → 'Hello'
    patternStep(new RegExp(`^<message\\s+speaker=["']${escapedName}["'][^>]*>\\s*`, 'i')),
    // Simple name prefix: "Emily: Hello" → "Hello"
    patternStep(new RegExp(`^${escapedName}:\\s*(?:\\[[^\\]]+?\\]\\s*)?`, 'i')),
    // Standalone timestamp: "[2m ago] Hello" → "Hello"
    patternStep(/^\[[^\]]+?\]\s*/),
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
 * The id-tag shapes the platform actually emits. `assignGroupTags` in
 * `participantUtils.ts` cuts a tag from `hexOf(id)` — the id lowercased with
 * hyphens REMOVED — at 4 chars, then 8, then the whole 32-char hex string. So
 * the full form is hyphen-free hex, not a hyphenated UUID. Bounded to exactly
 * those three widths: an unbounded `(id:...)` would delete a character's
 * legitimate parenthetical. Case-insensitive because this hunts a MODEL's echo
 * of the format, and an echo is not bound to the platform's casing.
 *
 * Leading whitespace is absorbed with the tag: the platform renders a tag as
 * ` (id:xxxx)` after a name, so deleting the tag alone would leave a double
 * space in reader-visible output (`Vlad  said`) — and an echo is not bound to
 * the platform's single space, so a short run is absorbed. Bounded ({0,3})
 * rather than unbounded because an open-ended quantifier before a literal is
 * quadratic on long whitespace runs (regexp/no-super-linear-move).
 */
const ID_TAG_PATTERN = /[ \t]{0,3}\(id:(?:[0-9a-f]{4}|[0-9a-f]{8}|[0-9a-f]{32})\)/gi;

/**
 * Strip the real-message form's own vocabulary out of model output: LEADING
 * header-shaped lines (iteratively — stacked echoes count per line), and
 * platform id tags anywhere. Both are echo-dynamics
 * hygiene — every write-direction slip that survives teaches the channel the
 * header format it is meant to learn only to READ.
 *
 * Flag-gated by the caller (`ResponsePostProcessor`), never here: flag-off the
 * model never saw a header or a tag, so these strips would be pure
 * false-positive risk.
 */
export function stripRealMessageEchoArtifacts(
  content: string,
  telemetry: HeaderSpoofTelemetry
): string {
  // Iterative, not single-shot: a model regurgitating several recent turns
  // verbatim stacks multiple header-shaped lines at the start, and a
  // single-pass strip would count 1 while the generic artifact pass quietly
  // ate the rest under a different log label — undercounting exactly what
  // this telemetry exists to count. Each pass removes at least one
  // character, so the loop terminates.
  let withoutHeader = content;
  let headerLinesStripped = 0;
  for (;;) {
    const next = withoutHeader.replace(leadingHeaderLineMatcher(), '');
    if (next === withoutHeader) {
      break;
    }
    withoutHeader = next;
    headerLinesStripped += 1;
  }

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

  if (headerLinesStripped > 0 || idTagsStripped > 0) {
    logger.warn(
      {
        channelId: telemetry.channelId,
        requestId: telemetry.requestId,
        headerLinesStripped,
        idTagsStripped,
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
