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
 */

import { createLogger } from '@tzurot/common-types';
import type { MessageContent } from '@tzurot/common-types';

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
 * Build artifact patterns for a given personality name
 */
function buildArtifactPatterns(personalityName: string): RegExp[] {
  const escapedName = personalityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return [
    // Leading <last_message> block: model echoes prompt structure (learned from training data)
    // '<last_message>User: hello</last_message>\n\nResponse' → 'Response'
    /^<last_message>[\s\S]*?<\/last_message>\s*/i,
    // Leading <from> tag: model echoes speaker identification from prompt
    // '<from id="abc">Kevbear</from>\n\nHello' → 'Hello'
    /^<from\b[^>]*>[^<]*<\/from>\s*/i,
    // Self-contained hallucinated tags with short content: catches metadata echoes like
    // <result>PersonalityName</result> or <parameter name="char">Name</parameter>.
    // Max 100 chars prevents stripping tags that contain the actual response.
    // MUST come before leading opening tag pattern so matched pairs are stripped as a unit.
    /^<(result|result_text|parameter|character|name|content)(?:\s[^>]*)?>[^<\n]{0,100}<\/\1>\s*/i,
    // Leading hallucinated tool-use opening tags: GLM 4.5 Air (and similar models trained on
    // Anthropic/OpenAI data) wrap responses in XML tool-use structures like <function_calls>,
    // <invoke>, <results>, etc. Strip known tag families at start of content only.
    /^<(?:function_calls|function_results|invoke|results|result|result_text|parameter|content|character|name|tool_calls|tool_results|tool_call|tool_result)(?:\s[^>]*)?>[ \t]*\n?/i,
    // Leading hallucinated closing tags: after inner content is stripped, orphaned closing tags
    // like </result> or </function_results> remain at the start. Strip them too.
    /^<\/(?:function_calls|function_results|invoke|results|result|result_text|parameter|content|character|name|tool_calls|tool_results|tool_call|tool_result)>[ \t]*\n?/i,
    // Leading <received message>...</received> block: GLM 4.5 Air echoes the user's message
    // in a hallucinated receipt structure before responding
    /^<received(?:\s+message)?(?:\s[^>]*)?>[\s\S]*?<\/received>\s*/i,
    // Prompt template orphan closing tags: model echoes closing tags from the system prompt's
    // XML structure (e.g., </chat_log> from PromptBuilder.ts). Stripped from anywhere in content
    // since they can appear mid-response, not just trailing.
    /<\/(?:chat_log|participants|protocol|memory_archive|contextual_references)>/gi,
    // Trailing <reactions>...</reactions> block: LLM mimics conversation history metadata
    // Must be checked before simpler trailing tags since it's multiline
    /\s*<reactions>[\s\S]*?<\/reactions>\s*$/i,
    // Generic trailing closing tag: catches </message>, </module>, </current_turn>, etc.
    // Models learn XML patterns from training data and append stray closing tags
    /<\/[a-z][a-z0-9_-]*>\s*$/i,
    // XML message prefix: '<message speaker="Emily">Hello' → 'Hello'
    new RegExp(`^<message\\s+speaker=["']${escapedName}["'][^>]*>\\s*`, 'i'),
    // Simple name prefix: "Emily: Hello" → "Hello"
    new RegExp(`^${escapedName}:\\s*(?:\\[[^\\]]+?\\]\\s*)?`, 'i'),
    // Standalone timestamp: "[2m ago] Hello" → "Hello"
    /^\[[^\]]+?\]\s*/,
  ];
}

/**
 * Apply patterns iteratively until no more matches
 */
function applyPatternsIteratively(
  content: string,
  patterns: RegExp[],
  maxIterations: number
): { cleaned: string; strippedCount: number } {
  let cleaned = content;
  let strippedCount = 0;

  while (strippedCount < maxIterations) {
    const beforeStrip = cleaned;
    let matched = false;

    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, '').trim();
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
      `[ResponseArtifacts] Stripped ${strippedCount} artifact(s) (${charsRemoved} chars) from response. ` +
        `LLM learned pattern from conversation history.`
    );
  }

  return cleaned;
}

/**
 * Normalize text for echo-match comparison: strip leading @mention, lowercase,
 * collapse whitespace, trim. Intentionally NOT Unicode-normalized — `.toLowerCase()`
 * is a no-op for non-cased scripts (Hebrew, Arabic, CJK), so comparison still
 * works character-for-character for those.
 *
 * @internal Exported for testing
 */
export function normalizeForEchoMatch(s: string): string {
  return s
    .replace(/^\s*@\S+\s*/, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
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
 * Note: only `@<name>` text-form mentions are stripped from the leading
 * position. Discord's `<@numericId>` mention format is intentionally out of
 * scope — the observed bug uses the text form, and the `<@` format would be
 * caught (or pass through harmlessly) via the `<received>` patterns in
 * `stripResponseArtifacts` or left alone.
 */
function findEchoCutIndex(response: string, userTextNormalized: string): number {
  if (userTextNormalized.length === 0) {
    return -1;
  }

  // Skip optional leading @mention prefix in the response.
  // Matches `normalizeForEchoMatch`'s first transform so boundaries line up.
  const mentionMatch = /^\s*@\S+\s*/.exec(response);
  let i = mentionMatch !== null ? mentionMatch[0].length : 0;

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
  const strippedChars = content.length - stripped.length;

  // Safety guard: refuse to strip if we'd remove more than MAX_STRIP_RATIO
  // of the response. The model likely regurgitated the input instead of
  // responding — leave it visible so the real failure surfaces.
  if (stripped.length < content.length * (1 - MAX_STRIP_RATIO)) {
    logger.warn(
      {
        strippedChars,
        responseLength: content.length,
        personalityName,
      },
      '[ResponseArtifacts] Skipping user-message-echo strip — would remove >80% of response'
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
    '[ResponseArtifacts] Stripped leading user-message echo — model learned echo pattern'
  );
  return stripped;
}
