/**
 * Consistent Date Formatting Utilities
 *
 * Provides standardized date formatting across all services.
 * All dates are formatted in Eastern timezone (APP_SETTINGS.TIMEZONE).
 */

import { APP_SETTINGS } from '../constants/index.js';

/**
 * Parse a flexible timestamp input into a Date, returning null for invalid values.
 */
function parseTimestamp(input: Date | string | number): Date | null {
  const d = typeof input === 'object' ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

/** Resolve an optional timezone to a concrete IANA string. */
function resolveTimezone(timezone?: string): string {
  return timezone ?? APP_SETTINGS.TIMEZONE;
}

/**
 * Format a time delta with proper singular/plural form
 */
function formatTimeUnit(value: number, unit: string): string {
  return value === 1 ? `1 ${unit} ago` : `${value} ${unit}s ago`;
}

/**
 * Format a date with full context: day of week, date, time, timezone
 *
 * Example: "Monday, January 27, 2025, 02:45 AM EST"
 *
 * Used for:
 * - Current date in system prompt
 * - Displaying when context was generated
 *
 * @param date - Date to format
 * @param timezone - Optional IANA timezone (e.g., 'America/New_York'). Defaults to APP_SETTINGS.TIMEZONE
 */
export function formatFullDateTime(date: Date | string | number, timezone?: string): string {
  const d = parseTimestamp(date);
  if (!d) {return 'Invalid Date';}

  const tz = resolveTimezone(timezone);

  return d.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
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
 *
 * @param date - Date to format
 * @param timezone - Optional IANA timezone (e.g., 'America/New_York'). Defaults to APP_SETTINGS.TIMEZONE
 */
export function formatDateOnly(date: Date | string | number, timezone?: string): string {
  const d = parseTimestamp(date);
  if (!d) {return 'Invalid Date';}

  const tz = resolveTimezone(timezone);

  // Format as YYYY-MM-DD
  const parts = d
    .toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: tz,
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
 *
 * @param timestamp - Timestamp to format
 * @param timezone - Optional IANA timezone for absolute date fallback. Defaults to APP_SETTINGS.TIMEZONE
 */
export function formatRelativeTime(timestamp: Date | string | number, timezone?: string): string {
  const date = parseTimestamp(timestamp);
  if (!date) {return '';}

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) {
    return 'just now';
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  // For older messages, show absolute date (YYYY-MM-DD)
  return formatDateOnly(date, timezone);
}

/**
 * Format a timestamp for memory display in prompts
 *
 * Example: "Mon, Jan 27, 2025"
 *
 * Used for:
 * - LTM memory timestamps in system prompt
 * - More compact than full format but still includes day of week
 *
 * @param timestamp - Timestamp to format
 * @param timezone - Optional IANA timezone (e.g., 'America/New_York'). Defaults to APP_SETTINGS.TIMEZONE
 */
export function formatMemoryTimestamp(
  timestamp: Date | string | number,
  timezone?: string
): string {
  const date = parseTimestamp(timestamp);
  if (!date) {return '';}

  const tz = resolveTimezone(timezone);

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  });
}

/**
 * Format a human-readable relative time delta for LTM memories
 *
 * Unlike formatRelativeTime which is optimized for STM (short-term memory)
 * and falls back to absolute dates after 7 days, this function always returns
 * a relative description suitable for making temporal distance visceral to LLMs.
 *
 * Examples:
 * - "just now"
 * - "5 minutes ago"
 * - "2 hours ago"
 * - "yesterday"
 * - "3 days ago"
 * - "1 week ago"
 * - "2 weeks ago"
 * - "1 month ago"
 * - "3 months ago"
 * - "1 year ago"
 * - "2 years ago"
 *
 * Used for:
 * - LTM memory entries (helps LLM understand temporal distance)
 * - Referenced message timestamps
 *
 * @param timestamp - Timestamp to calculate delta from
 * @returns Human-readable relative time string
 */
export function formatRelativeTimeDelta(timestamp: Date | string | number): string {
  const date = parseTimestamp(timestamp);
  if (!date) {return '';}

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // Handle future dates
  if (diffMs < 0) {
    return 'in the future';
  }

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  // Note: Using fixed 30/365 day approximations is intentional for LLM context.
  // Exact month/year calculations aren't needed - "about 2 months ago" is sufficient
  // for making temporal distance visceral to the LLM. ±3-4 day variance is acceptable.
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  // Within a minute
  if (diffMinutes < 1) {
    return 'just now';
  }

  // Within an hour
  if (diffMinutes < 60) {
    return formatTimeUnit(diffMinutes, 'minute');
  }

  // Within a day
  if (diffHours < 24) {
    return formatTimeUnit(diffHours, 'hour');
  }

  // Yesterday (special case)
  if (diffDays === 1) {
    return 'yesterday';
  }

  // Within a week
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }

  // Within a month (use weeks)
  if (diffWeeks < 4) {
    return formatTimeUnit(diffWeeks, 'week');
  }

  // Within a year (use months)
  if (diffMonths < 12) {
    return formatTimeUnit(diffMonths, 'month');
  }

  // Years
  return formatTimeUnit(diffYears, 'year');
}

/**
 * Result type for memory timestamp with delta
 */
interface TimestampWithDelta {
  /** Absolute date (e.g., "Mon, Jan 15, 2025") */
  absolute: string;
  /** Relative time delta (e.g., "2 weeks ago") */
  relative: string;
}

/**
 * Format a timestamp with both absolute date and relative time delta
 *
 * This is the recommended function for LTM memory formatting as it provides
 * both the precise date and a human-readable temporal distance.
 *
 * Example:
 * {
 *   absolute: "Mon, Jan 15, 2025",
 *   relative: "2 weeks ago"
 * }
 *
 * Used for:
 * - LTM memory entries in prompts
 * - Referenced message formatting
 *
 * @param timestamp - Timestamp to format
 * @param timezone - Optional IANA timezone. Defaults to APP_SETTINGS.TIMEZONE
 * @returns Object with both absolute and relative formats
 */
export function formatTimestampWithDelta(
  timestamp: Date | string | number,
  timezone?: string
): TimestampWithDelta {
  return {
    absolute: formatMemoryTimestamp(timestamp, timezone),
    relative: formatRelativeTimeDelta(timestamp),
  };
}

/**
 * Format a timestamp for prompt display with unified format
 *
 * Format: "YYYY-MM-DD (Day) HH:MM • relative"
 * Example: "2025-12-02 (Tue) 21:12 • 2h ago"
 *
 * For older timestamps (>7 days), omits time:
 * Example: "2025-11-15 (Fri) • 2 months ago"
 *
 * Used for:
 * - Message timestamps in chat_log
 * - Referenced message timestamps
 * - Memory timestamps in memory_archive
 *
 * @param timestamp - Timestamp to format
 * @param timezone - Optional IANA timezone. Defaults to APP_SETTINGS.TIMEZONE
 * @returns Unified timestamp string, or empty string for invalid date
 */
export function formatPromptTimestamp(
  timestamp: Date | string | number,
  timezone?: string
): string {
  const date = parseTimestamp(timestamp);
  if (!date) {return '';}

  const tz = resolveTimezone(timezone);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Get day of week abbreviation
  const dayOfWeek = date.toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: tz,
  });

  // Get date in YYYY-MM-DD format
  const datePart = formatDateOnly(date, tz);

  // Get relative time
  const relative = formatRelativeTimeDelta(timestamp);

  // For recent messages (< 7 days), include time
  if (diffDays < 7) {
    const time = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
    });
    return `${datePart} (${dayOfWeek}) ${time} • ${relative}`;
  }

  // For older messages, omit time (less relevant)
  return `${datePart} (${dayOfWeek}) • ${relative}`;
}
