/**
 * Prompt Placeholder Utilities
 *
 * Centralized utilities for replacing placeholders in prompts and memory content.
 * Used across LTM retrieval, system prompts, personality fields, and LLM outputs.
 *
 * Supports multiple placeholder formats for compatibility with legacy data:
 * - User: {user}, {{user}}
 * - Assistant: {assistant}, {shape}, {{char}}, {personality}
 */

import { PLACEHOLDERS } from '@tzurot/common-types';

/**
 * Replace user and assistant placeholders with actual names
 *
 * Handles all supported placeholder variations for compatibility with legacy data
 * imported from other providers (Character.AI, etc.).
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
 * ```
 */
export function replacePromptPlaceholders(
  text: string,
  userName: string,
  assistantName: string
): string {
  let result = text;

  // Replace all user placeholder variations
  for (const placeholder of PLACEHOLDERS.USER) {
    // Escape special regex characters in placeholder
    const escapedPlaceholder = placeholder.replace(/[{}]/g, '\\$&');
    result = result.replace(new RegExp(escapedPlaceholder, 'g'), userName);
  }

  // Replace all assistant placeholder variations
  for (const placeholder of PLACEHOLDERS.ASSISTANT) {
    // Escape special regex characters in placeholder
    const escapedPlaceholder = placeholder.replace(/[{}]/g, '\\$&');
    result = result.replace(new RegExp(escapedPlaceholder, 'g'), assistantName);
  }

  return result;
}
