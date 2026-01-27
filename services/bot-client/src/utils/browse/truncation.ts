/**
 * Browse Truncation Utilities
 *
 * Functions for truncating text to fit Discord's limits for
 * select menu labels and descriptions.
 */

import { MAX_SELECT_LABEL_LENGTH, MAX_SELECT_DESCRIPTION_LENGTH } from './constants.js';

/**
 * Truncate text for select menu labels/descriptions.
 * Adds ellipsis when text is truncated.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length (defaults to MAX_SELECT_LABEL_LENGTH)
 * @returns Truncated text with ellipsis if needed
 *
 * @example
 * ```typescript
 * truncateForSelect('Short text'); // 'Short text'
 * truncateForSelect('Very long text...', 10); // 'Very lo...'
 * ```
 */
export function truncateForSelect(
  text: string,
  maxLength: number = MAX_SELECT_LABEL_LENGTH
): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Truncate text specifically for select menu descriptions.
 * Convenience function that uses MAX_SELECT_DESCRIPTION_LENGTH.
 *
 * @param text - Text to truncate
 * @returns Truncated text
 */
export function truncateForDescription(text: string): string {
  return truncateForSelect(text, MAX_SELECT_DESCRIPTION_LENGTH);
}
