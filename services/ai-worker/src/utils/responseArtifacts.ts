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

const logger = createLogger('ResponseArtifacts');

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
