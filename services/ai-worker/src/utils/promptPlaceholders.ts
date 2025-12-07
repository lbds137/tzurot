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
 * Replace user and assistant placeholders with actual names
 *
 * Handles all supported placeholder variations for compatibility with legacy data
 * imported from other providers (Character.AI, etc.).
 *
 * Placeholder matching is case-insensitive: {{Char}}, {{CHAR}}, and {{char}}
 * are all treated the same.
 *
 * @param text - Text containing placeholders
 * @param userName - The user/persona name to replace user placeholders with
 * @param assistantName - The assistant/personality name to replace assistant placeholders with
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
 * ```
 */
export function replacePromptPlaceholders(
  text: string,
  userName: string,
  assistantName: string
): string {
  let result = text;

  // Replace all user placeholder variations (case-insensitive)
  // Process longer placeholders first to avoid partial replacements
  const userPlaceholders = [...PLACEHOLDERS.USER].sort((a, b) => b.length - a.length);
  for (const placeholder of userPlaceholders) {
    // Escape special regex characters in placeholder
    const escapedPlaceholder = placeholder.replace(/[{}]/g, '\\$&');
    result = result.replace(new RegExp(escapedPlaceholder, 'gi'), userName);
  }

  // Replace all assistant placeholder variations (case-insensitive)
  // Process longer placeholders first to avoid partial replacements
  const assistantPlaceholders = [...PLACEHOLDERS.ASSISTANT].sort((a, b) => b.length - a.length);
  for (const placeholder of assistantPlaceholders) {
    // Escape special regex characters in placeholder
    const escapedPlaceholder = placeholder.replace(/[{}]/g, '\\$&');
    result = result.replace(new RegExp(escapedPlaceholder, 'gi'), assistantName);
  }

  return result;
}
