/**
 * Discord Markdown Utilities
 *
 * Utilities for safely handling Discord markdown formatting.
 */

/**
 * Escape markdown special characters in a string.
 * Escapes backslashes first to prevent double-escaping issues.
 *
 * @param text - The text to escape
 * @returns The escaped text safe for Discord markdown
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/\*/g, '\\*'); // Then escape asterisks
}
