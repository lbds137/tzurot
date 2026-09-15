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
}

/**
 * Common timezone options organized by region
 * Covers major populated areas with distinct offsets
 */
export const TIMEZONE_OPTIONS: readonly TimezoneOption[] = [
  // Americas
  { value: 'America/New_York', label: 'Eastern Time (US)' },
  { value: 'America/Chicago', label: 'Central Time (US)' },
  { value: 'America/Denver', label: 'Mountain Time (US)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US)' },
  { value: 'America/Anchorage', label: 'Alaska Time' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time' },
  { value: 'America/Toronto', label: 'Eastern Time (Canada)' },
  { value: 'America/Vancouver', label: 'Pacific Time (Canada)' },
  { value: 'America/Sao_Paulo', label: 'Brasília Time' },
  { value: 'America/Mexico_City', label: 'Mexico City' },
  // Europe
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Central European' },
  { value: 'Europe/Berlin', label: 'Berlin' },
  { value: 'Europe/Moscow', label: 'Moscow' },
  // Asia
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Asia/Kolkata', label: 'India Standard' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Shanghai', label: 'China Standard' },
  { value: 'Asia/Tokyo', label: 'Japan Standard' },
  { value: 'Asia/Seoul', label: 'Korea Standard' },
  // Oceania
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'Australia/Melbourne', label: 'Melbourne' },
  { value: 'Pacific/Auckland', label: 'New Zealand' },
  // Special
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
] as const;

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

/**
 * Render the UTC offset of a zone at a given instant: 'UTC+1', 'UTC-4',
 * 'UTC+5:30', 'UTC+0'.
 *
 * Derived per call rather than stored, so a DST transition is reflected
 * without a process restart. Intl emits this offset as 'GMT+1' / 'GMT-4' /
 * 'GMT+5:30', and a BARE 'GMT' at a zero offset — probed on Node 24 for
 * 'UTC', for 'Europe/London' in January, and for 'Africa/Accra' — so the bare
 * form needs its own branch to reach 'UTC+0'. Pinned by the 'UTC' and
 * winter-'Europe/London' cases in timezone.test.ts.
 *
 * Returns 'Unknown' for a string Intl cannot format as a time zone.
 */
export function timezoneOffsetLabel(value: string, at: Date = new Date()): string {
  let shortOffset: string | undefined;

  try {
    shortOffset = new Intl.DateTimeFormat('en-US', {
      timeZone: value,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(at)
      .find(part => part.type === 'timeZoneName')?.value;
  } catch {
    return 'Unknown';
  }

  if (shortOffset === undefined) {
    return 'Unknown';
  }

  // A zero offset carries neither sign nor digits, so it is its own case
  // rather than a prefix substitution.
  if (shortOffset === 'GMT') {
    return 'UTC+0';
  }

  return shortOffset.replace('GMT', 'UTC');
}

/**
 * Display name for a timezone: '<label> - <derived offset>' for a zone in
 * TIMEZONE_OPTIONS, and the bare IANA value for anything else.
 */
export function timezoneDisplayName(value: string, at: Date = new Date()): string {
  const info = getTimezoneInfo(value);

  if (info === undefined) {
    return value;
  }

  return `${info.label} - ${timezoneOffsetLabel(value, at)}`;
}
