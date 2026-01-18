/**
 * Memory Command Formatters
 * Shared formatting utilities for memory list, search, and detail views
 */

/** Collector timeout in milliseconds (5 minutes) */
export const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000;

/** Default max length for content truncation */
export const DEFAULT_MAX_CONTENT_LENGTH = 200;

/**
 * Discord embed description character limit.
 * We use 3800 (vs 4096 max) to leave buffer for escapeMarkdown expansion
 * and to avoid edge cases with multi-byte characters.
 */
export const EMBED_DESCRIPTION_SAFE_LIMIT = 3800;

/**
 * Format date for compact list display (short year, no time)
 * Example: "Jan 15, '25"
 */
export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

/**
 * Format date with full year and time for detail views
 * Example: "Jan 15, 2025, 3:45 PM"
 */
export function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format similarity score for display
 * Returns percentage for semantic search or 'text match' for fallback
 */
export function formatSimilarity(similarity: number | null): string {
  if (similarity === null) {
    return 'text match';
  }
  const percentage = Math.round(similarity * 100);
  return `${percentage}%`;
}

/**
 * Truncate content for compact display
 * Removes newlines and truncates to maxLength with ellipsis
 */
export function truncateContent(
  content: string,
  maxLength: number = DEFAULT_MAX_CONTENT_LENGTH
): string {
  // Remove newlines for compact single-line display
  const singleLine = content.replace(/\n+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return singleLine.substring(0, maxLength - 3) + '...';
}
