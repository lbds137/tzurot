/**
 * Service Constants
 *
 * Network, service defaults, application settings, and health status.
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
