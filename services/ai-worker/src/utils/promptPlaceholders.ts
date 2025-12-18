/**
 * Prompt Placeholder Utilities
 *
 * Centralized utilities for replacing placeholders in prompts and memory content.
 * Used across LTM retrieval, system prompts, personality fields, and LLM outputs.
 *
 * Supports multiple placeholder formats for compatibility with legacy data:
 * - User: {user}, {{user}}
 * - Assistant: {assistant}, {shape}, {{char}}, {personality}
 *
 * All placeholder matching is case-insensitive ({{Char}} is treated as {{char}}).
 */

import { PLACEHOLDERS } from '@tzurot/common-types';

/**
 * Escape all regex special characters in a string
 * This ensures the string can be safely used in a RegExp constructor
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace user and assistant placeholders with actual names
 *
 * Handles all supported placeholder variations for compatibility with legacy data
 * imported from other providers (Character.AI, etc.).
 *
 * Placeholder matching is case-insensitive: {{Char}}, {{CHAR}}, and {{char}}
 * are all treated the same.
 *
 * When userName matches assistantName (case-insensitive), the discordUsername
 * is used to disambiguate: "Lila (@lbds137)" instead of just "Lila".
 *
 * @param text - Text containing placeholders
 * @param userName - The user/persona name to replace user placeholders with
 * @param assistantName - The assistant/personality name to replace assistant placeholders with
 * @param discordUsername - Optional Discord username for disambiguation when names collide
 * @returns Text with all placeholders replaced
 *
 * @example
 * ```typescript
 * const text = "{{user}}: How are you?\n{{char}}: I'm doing well!";
 * const result = replacePromptPlaceholders(text, "Alice", "Lilith");
 * // Result: "Alice: How are you?\nLilith: I'm doing well!"
 *
 * // Case-insensitive matching:
 * const text2 = "{{User}}: Hello\n{{Char}}: Hi!";
 * const result2 = replacePromptPlaceholders(text2, "Bob", "Eve");
 * // Result: "Bob: Hello\nEve: Hi!"
 *
 * // Name collision with disambiguation:
 * const text3 = "{user}: Hello\n{assistant}: Hi!";
 * const result3 = replacePromptPlaceholders(text3, "Lila", "Lila", "lbds137");
 * // Result: "Lila (@lbds137): Hello\nLila: Hi!"
 * ```
 */
export function replacePromptPlaceholders(
  text: string,
  userName: string,
  assistantName: string,
  discordUsername?: string
): string {
  let result = text;

  // Determine the effective user name (disambiguate if it matches assistant name)
  let effectiveUserName = userName;
  if (
    userName.toLowerCase() === assistantName.toLowerCase() &&
    discordUsername !== undefined &&
    discordUsername.length > 0
  ) {
    effectiveUserName = `${userName} (@${discordUsername})`;
  }

  // Replace all user placeholder variations (case-insensitive)
  // Process longer placeholders first to avoid partial replacements
  const userPlaceholders = [...PLACEHOLDERS.USER].sort((a, b) => b.length - a.length);
  for (const placeholder of userPlaceholders) {
    const escapedPlaceholder = escapeRegExp(placeholder);
    result = result.replace(new RegExp(escapedPlaceholder, 'gi'), effectiveUserName);
  }

  // Replace all assistant placeholder variations (case-insensitive)
  // Process longer placeholders first to avoid partial replacements
  const assistantPlaceholders = [...PLACEHOLDERS.ASSISTANT].sort((a, b) => b.length - a.length);
  for (const placeholder of assistantPlaceholders) {
    const escapedPlaceholder = escapeRegExp(placeholder);
    result = result.replace(new RegExp(escapedPlaceholder, 'gi'), assistantName);
  }

  return result;
}
