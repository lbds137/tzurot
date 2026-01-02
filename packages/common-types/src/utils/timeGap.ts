/**
 * Time Gap Marker Utilities
 *
 * Helps format time gaps between messages in conversation history.
 * These markers help AI understand temporal breaks in conversations.
 *
 * @example
 * const gapMs = calculateGap(msg1.timestamp, msg2.timestamp);
 * if (shouldShowGap(gapMs)) {
 *   // Insert gap marker: "--- 2 hours later ---"
 *   const marker = formatTimeGap(gapMs);
 * }
 */

/**
 * Configuration for time gap detection
 */
export interface TimeGapConfig {
  /** Minimum gap in milliseconds to show a marker (default: 1 hour) */
  minGapMs: number;
}

/** Default configuration: 1 hour minimum gap */
export const DEFAULT_TIME_GAP_CONFIG: TimeGapConfig = {
  minGapMs: 60 * 60 * 1000, // 1 hour
};

/** Time unit definitions for formatting [ms value, singular, plural] */
const TIME_UNITS: [number, string, string][] = [
  [7 * 24 * 60 * 60 * 1000, 'week', 'weeks'],
  [24 * 60 * 60 * 1000, 'day', 'days'],
  [60 * 60 * 1000, 'hour', 'hours'],
  [60 * 1000, 'minute', 'minutes'],
];

/**
 * Determine if a time gap is significant enough to warrant a marker
 *
 * @param gapMs - Gap in milliseconds between messages
 * @param config - Optional configuration (defaults to 1 hour threshold)
 * @returns true if gap should be marked
 */
export function shouldShowGap(gapMs: number, config?: TimeGapConfig): boolean {
  const threshold = config?.minGapMs ?? DEFAULT_TIME_GAP_CONFIG.minGapMs;
  return gapMs >= threshold;
}

/**
 * Calculate the time gap between two timestamps
 *
 * @param earlier - Earlier timestamp (Date, ISO string, or ms since epoch)
 * @param later - Later timestamp (Date, ISO string, or ms since epoch)
 * @returns Gap in milliseconds (absolute value, so order doesn't matter)
 */
export function calculateTimeGap(
  earlier: Date | string | number,
  later: Date | string | number
): number {
  const time1 = earlier instanceof Date ? earlier.getTime() : new Date(earlier).getTime();
  const time2 = later instanceof Date ? later.getTime() : new Date(later).getTime();
  return Math.abs(time2 - time1);
}

/**
 * Format a time gap as a human-readable duration
 *
 * Returns the largest clean unit, or a combination if needed.
 *
 * @example
 * formatTimeGap(3600000)      // "1 hour"
 * formatTimeGap(7200000)      // "2 hours"
 * formatTimeGap(5400000)      // "1 hour 30 minutes"
 * formatTimeGap(86400000)     // "1 day"
 * formatTimeGap(90000000)     // "1 day 1 hour"
 *
 * @param gapMs - Gap in milliseconds
 * @returns Human-readable duration string
 */
export function formatTimeGap(gapMs: number): string {
  if (gapMs < 60 * 1000) {
    return 'less than a minute';
  }

  const parts: string[] = [];
  let remaining = gapMs;

  // Find up to 2 significant units (e.g., "1 day 2 hours")
  for (const [unitMs, singular, plural] of TIME_UNITS) {
    if (remaining >= unitMs) {
      const value = Math.floor(remaining / unitMs);
      parts.push(`${value} ${value === 1 ? singular : plural}`);
      remaining = remaining % unitMs;

      // Stop after 2 units for readability
      if (parts.length >= 2) {
        break;
      }
    }
  }

  return parts.join(' ');
}

/**
 * Format a time gap marker for XML context
 *
 * @example
 * formatTimeGapMarker(7200000) // '<time_gap duration="2 hours" />'
 *
 * @param gapMs - Gap in milliseconds
 * @returns XML element string
 */
export function formatTimeGapMarker(gapMs: number): string {
  const duration = formatTimeGap(gapMs);
  return `<time_gap duration="${duration}" />`;
}
