/** The Redis URL component/contract tests fall back to when none is configured. */
export const DEFAULT_TEST_REDIS_URL = 'redis://localhost:6379';

/**
 * Resolve the Redis URL for the test environment from the raw `REDIS_URL`
 * value. A blank value counts as unset: a `REDIS_URL=` row in a sourced .env
 * yields '', and `new URL('')` would throw rather than use the default.
 */
export function resolveTestRedisUrl(envValue: string | undefined): string {
  return envValue !== undefined && envValue.length > 0 ? envValue : DEFAULT_TEST_REDIS_URL;
}
