/**
 * Service Constants
 *
 * Network, service defaults, application settings, health status, and validation patterns.
 */

/**
 * Network and service defaults
 */
export const SERVICE_DEFAULTS = {
  /** Default Redis port */
  REDIS_PORT: 6379,
  /** Default API gateway port */
  API_GATEWAY_PORT: 3000,
} as const;

/**
 * UUID validation pattern (RFC 4122 compliant)
 * Matches standard UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Check if a string is a valid UUID
 * @param value - String to validate
 * @returns True if the string is a valid UUID
 */
export function isValidUUID(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && UUID_REGEX.test(value);
}

/**
 * Application-wide settings
 */
export const APP_SETTINGS = {
  /** Default timezone for timestamp formatting */
  TIMEZONE: 'America/New_York',
} as const;

/**
 * Health check status values
 */
export enum HealthStatus {
  Healthy = 'healthy',
  Degraded = 'degraded',
  Unhealthy = 'unhealthy',
  Ok = 'ok',
  Error = 'error',
}
