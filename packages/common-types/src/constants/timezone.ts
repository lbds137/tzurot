/**
 * Timezone Constants
 *
 * Centralized timezone definitions for consistent UX across services.
 */

/**
 * Timezone option for UI dropdowns
 */
interface TimezoneOption {
  /** IANA timezone identifier (e.g., 'America/New_York') */
  value: string;
  /** Human-readable label (e.g., 'Eastern Time (US)') */
  label: string;
  /** UTC offset string (e.g., 'UTC-5') */
  offset: string;
}

/**
 * Common timezone options organized by region
 * Covers major populated areas with distinct offsets
 */
export const TIMEZONE_OPTIONS: readonly TimezoneOption[] = [
  // Americas
  { value: 'America/New_York', label: 'Eastern Time (US)', offset: 'UTC-5' },
  { value: 'America/Chicago', label: 'Central Time (US)', offset: 'UTC-6' },
  { value: 'America/Denver', label: 'Mountain Time (US)', offset: 'UTC-7' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US)', offset: 'UTC-8' },
  { value: 'America/Anchorage', label: 'Alaska Time', offset: 'UTC-9' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time', offset: 'UTC-10' },
  { value: 'America/Toronto', label: 'Eastern Time (Canada)', offset: 'UTC-5' },
  { value: 'America/Vancouver', label: 'Pacific Time (Canada)', offset: 'UTC-8' },
  { value: 'America/Sao_Paulo', label: 'Brasília Time', offset: 'UTC-3' },
  { value: 'America/Mexico_City', label: 'Mexico City', offset: 'UTC-6' },
  // Europe
  { value: 'Europe/London', label: 'London (GMT/BST)', offset: 'UTC+0' },
  { value: 'Europe/Paris', label: 'Central European', offset: 'UTC+1' },
  { value: 'Europe/Berlin', label: 'Berlin', offset: 'UTC+1' },
  { value: 'Europe/Moscow', label: 'Moscow', offset: 'UTC+3' },
  // Asia
  { value: 'Asia/Dubai', label: 'Dubai', offset: 'UTC+4' },
  { value: 'Asia/Kolkata', label: 'India Standard', offset: 'UTC+5:30' },
  { value: 'Asia/Singapore', label: 'Singapore', offset: 'UTC+8' },
  { value: 'Asia/Shanghai', label: 'China Standard', offset: 'UTC+8' },
  { value: 'Asia/Tokyo', label: 'Japan Standard', offset: 'UTC+9' },
  { value: 'Asia/Seoul', label: 'Korea Standard', offset: 'UTC+9' },
  // Oceania
  { value: 'Australia/Sydney', label: 'Sydney', offset: 'UTC+10' },
  { value: 'Australia/Melbourne', label: 'Melbourne', offset: 'UTC+10' },
  { value: 'Pacific/Auckland', label: 'New Zealand', offset: 'UTC+12' },
  // Special
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)', offset: 'UTC+0' },
] as const;

/**
 * Discord command choices format (max 25)
 * Provides name (display) and value (IANA identifier)
 */
export const TIMEZONE_DISCORD_CHOICES = TIMEZONE_OPTIONS.map(tz => ({
  name: `${tz.label} - ${tz.offset}`,
  value: tz.value,
}));

/**
 * Validate if a timezone string is valid
 * Accepts both common timezones and any valid IANA timezone
 */
export function isValidTimezone(tz: string): boolean {
  // Check if it's in our common list
  if (TIMEZONE_OPTIONS.some(t => t.value === tz)) {
    return true;
  }

  // Try to validate using Intl API
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get timezone info by value
 */
export function getTimezoneInfo(value: string): TimezoneOption | undefined {
  return TIMEZONE_OPTIONS.find(tz => tz.value === value);
}
