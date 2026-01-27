/**
 * Browse Truncation Utilities
 *
 * Functions for truncating text to fit Discord's limits for
 * select menu labels and descriptions.
 */

import { MAX_SELECT_LABEL_LENGTH, MAX_SELECT_DESCRIPTION_LENGTH } from './constants.js';

/** Options for truncateForSelect */
interface TruncateOptions {
  /** Maximum length (defaults to MAX_SELECT_LABEL_LENGTH) */
  maxLength?: number;
  /** Replace newlines with spaces before truncating */
  stripNewlines?: boolean;
}

/**
 * Truncate text for select menu labels/descriptions.
 * Adds ellipsis when text is truncated.
 *
 * @param text - Text to truncate
 * @param maxLengthOrOptions - Maximum length or options object
 * @returns Truncated text with ellipsis if needed
 *
 * @example
 * ```typescript
 * truncateForSelect('Short text'); // 'Short text'
 * truncateForSelect('Very long text...', 10); // 'Very lo...'
 * truncateForSelect('Multi\nline', { stripNewlines: true }); // 'Multi line'
 * ```
 */
export function truncateForSelect(
  text: string,
  maxLengthOrOptions?: number | TruncateOptions
): string {
  // Handle backwards-compatible overloaded signature
  const options: TruncateOptions =
    typeof maxLengthOrOptions === 'number'
      ? { maxLength: maxLengthOrOptions }
      : (maxLengthOrOptions ?? {});

  const maxLength = options.maxLength ?? MAX_SELECT_LABEL_LENGTH;

  // Strip newlines if requested
  const processedText = options.stripNewlines === true ? text.replace(/\n+/g, ' ').trim() : text;

  if (processedText.length <= maxLength) {
    return processedText;
  }
  return processedText.substring(0, maxLength - 3) + '...';
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
