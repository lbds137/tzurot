/**
 * Shared utilities for timezone commands
 * Used by both set.ts and get.ts to avoid code duplication (DRY)
 */

import { formatFullDateTime } from '@tzurot/common-types/utils/dateFormatting';

/**
 * Get the current time in a timezone using centralized formatting
 */
export function getCurrentTimeInTimezone(timezone: string): string {
  try {
    return formatFullDateTime(new Date(), timezone);
  } catch {
    return 'Unable to display time';
  }
}
