/**
 * Response Artifacts Cleanup
 *
 * Defensive cleaning of AI-generated responses to handle cases where the model
 * learns patterns from conversation history or training data and adds unwanted artifacts.
 *
 * With XML-formatted prompts, models may:
 * - Echo <from id="...">Name</from> tags (speaker identification from prompt)
 * - Append </message> tags (learning from chat_log structure)
 * - Append </current_turn> or </incoming_message> tags (from training data)
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
    // Leading <from> tag: model echoes speaker identification from prompt
    // '<from id="abc">Kevbear</from>\n\nHello' → 'Hello'
    /^<from\b[^>]*>[^<]*<\/from>\s*/i,
    // Trailing <reactions>...</reactions> block: LLM mimics conversation history metadata
    // Must be checked before simpler trailing tags since it's multiline
    /\s*<reactions>[\s\S]*?<\/reactions>\s*$/i,
    // Trailing </message> tag: "Hello!</message>" → "Hello!"
    /<\/message>\s*$/i,
    // Trailing </current_turn> tag: "Hello!</current_turn>" → "Hello!"
    /<\/current_turn>\s*$/i,
    // Trailing </incoming_message> tag: "Hello!</incoming_message>" → "Hello!"
    /<\/incoming_message>\s*$/i,
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
  const { cleaned, strippedCount } = applyPatternsIteratively(content, patterns, 5);

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
