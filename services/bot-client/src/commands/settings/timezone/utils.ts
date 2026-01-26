/**
 * Shared utilities for timezone commands
 * Used by both set.ts and get.ts to avoid code duplication (DRY)
 */

import { formatFullDateTime } from '@tzurot/common-types';

/**
 * Response type for timezone API calls
 */
export interface TimezoneResponse {
  timezone: string;
  label?: string;
  isDefault?: boolean;
}

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
