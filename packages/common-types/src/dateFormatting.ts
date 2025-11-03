/**
 * Consistent Date Formatting Utilities
 *
 * Provides standardized date formatting across all services.
 * All dates are formatted in Eastern timezone (APP_SETTINGS.TIMEZONE).
 */

import { APP_SETTINGS } from './constants.js';

/**
 * Format a date with full context: day of week, date, time, timezone
 *
 * Example: "Monday, January 27, 2025, 02:45 AM EST"
 *
 * Used for:
 * - Current date in system prompt
 * - Displaying when context was generated
 */
export function formatFullDateTime(date: Date | string | number): string {
  const d = typeof date === 'object' ? date : new Date(date);

  if (isNaN(d.getTime())) {
    return 'Invalid Date';
  }

  return d.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: APP_SETTINGS.TIMEZONE,
    timeZoneName: 'short',
  });
}

/**
 * Format a date as YYYY-MM-DD (compact date only, no time)
 *
 * Example: "2025-01-27"
 *
 * Used for:
 * - LTM memory timestamps (when full timestamp not needed)
 * - Log file names
 * - Date-based filtering
 */
export function formatDateOnly(date: Date | string | number): string {
  const d = typeof date === 'object' ? date : new Date(date);

  if (isNaN(d.getTime())) {
    return 'Invalid Date';
  }

  // Format as YYYY-MM-DD in Eastern timezone
  const parts = d
    .toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: APP_SETTINGS.TIMEZONE,
    })
    .split('/');

  return `${parts[2]}-${parts[0]}-${parts[1]}`; // YYYY-MM-DD
}

/**
 * Format relative time for recent timestamps, absolute date for older ones
 *
 * Examples:
 * - "just now"
 * - "5m ago"
 * - "2h ago"
 * - "3d ago"
 * - "2025-01-20" (for messages older than 7 days)
 *
 * Used for:
 * - STM conversation history timestamps
 * - Activity logs
 */
export function formatRelativeTime(timestamp: Date | string | number): string {
  const date = typeof timestamp === 'object' ? timestamp : new Date(timestamp);

  if (isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  // For older messages, show absolute date (YYYY-MM-DD)
  return formatDateOnly(date);
}

/**
 * Format a timestamp for memory display in prompts
 *
 * Example: "Mon, Jan 27, 2025"
 *
 * Used for:
 * - LTM memory timestamps in system prompt
 * - More compact than full format but still includes day of week
 */
export function formatMemoryTimestamp(timestamp: Date | string | number): string {
  const date = typeof timestamp === 'object' ? timestamp : new Date(timestamp);

  if (isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: APP_SETTINGS.TIMEZONE,
  });
}
