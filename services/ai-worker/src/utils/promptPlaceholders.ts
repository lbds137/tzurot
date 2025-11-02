/**
 * Prompt Placeholder Utilities
 *
 * Centralized utilities for replacing placeholders in prompts and memory content.
 * Used across LTM retrieval, system prompts, and any other prompt-building logic.
 */

/**
 * Replace {user} and {assistant} placeholders with actual names
 *
 * @param text - Text containing placeholders (e.g., "{user}: Hello\n{assistant}: Hi there")
 * @param userName - The user/persona name to replace {user} with
 * @param assistantName - The assistant/personality name to replace {assistant} with
 * @returns Text with placeholders replaced
 *
 * @example
 * ```typescript
 * const text = "{user}: How are you?\n{assistant}: I'm doing well!";
 * const result = replacePromptPlaceholders(text, "Alice", "Lilith");
 * // Result: "Alice: How are you?\nLilith: I'm doing well!"
 * ```
 */
export function replacePromptPlaceholders(
  text: string,
  userName: string,
  assistantName: string
): string {
  return text
    .replace(/\{user\}/g, userName)
    .replace(/\{assistant\}/g, assistantName);
}
