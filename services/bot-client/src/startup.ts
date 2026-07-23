/**
 * Startup Utilities
 *
 * Initialization and validation functions run during bot-client startup.
 */

import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('bot-client');

/**
 * Validate Discord token is configured
 * @throws Error if DISCORD_TOKEN is missing
 */
export function validateDiscordToken(config = getConfig()): void {
  if (config.DISCORD_TOKEN === undefined || config.DISCORD_TOKEN.length === 0) {
    logger.error('DISCORD_TOKEN is required for bot-client');
    throw new Error('DISCORD_TOKEN environment variable is required');
  }
}

/**
 * Validate Redis URL is configured
 * @throws Error if REDIS_URL is missing
 */
export function validateRedisUrl(config = getConfig()): void {
  if (config.REDIS_URL === undefined || config.REDIS_URL.length === 0) {
    throw new Error('REDIS_URL environment variable is required');
  }
}

/**
 * Validate internal service secret is configured. Throws at startup so a
 * misconfigured deploy fails to boot rather than silently sending empty
 * `X-Service-Auth` headers and watching every gateway call return 403.
 * Symmetric with the api-gateway and ai-worker startup checks.
 *
 * @throws Error if INTERNAL_SERVICE_SECRET is missing or empty
 */
export function validateInternalServiceSecret(config = getConfig()): void {
  if (config.INTERNAL_SERVICE_SECRET === undefined || config.INTERNAL_SERVICE_SECRET.length === 0) {
    throw new Error(
      'INTERNAL_SERVICE_SECRET environment variable is required (service-to-service auth for protected gateway routes)'
    );
  }
}

/**
 * Fail-closed guard for the outbound-DM allowlist. On any NON-production
 * environment, `OUTBOUND_DM_ALLOWLIST` MUST be set: dev's database is synced
 * from prod, so an unset allowlist points the dev bot at real prod users — the
 * exact boot-time DM-burst shape that earned a Discord DM quarantine.
 * `getOutboundDmAllowlist()` treats unset as "unrestricted" (correct for prod),
 * so without this assertion a fresh or misconfigured dev deploy silently falls
 * open. Refuse to boot instead. Prod is intentionally unrestricted and returns
 * early. The empty-check mirrors `getOutboundDmAllowlist`'s own null condition.
 *
 * @throws Error on a non-production environment with an unset/empty allowlist
 */
export function validateOutboundDmAllowlist(config = getConfig()): void {
  if (config.NODE_ENV === 'production') {
    return;
  }
  const raw = config.OUTBOUND_DM_ALLOWLIST;
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      `OUTBOUND_DM_ALLOWLIST must be set on non-production environments ` +
        `(NODE_ENV=${config.NODE_ENV}) — the dev database is synced from prod, so ` +
        `an unset allowlist lets the dev bot DM real prod users. Set it to your ` +
        `own Discord ID(s), comma-separated.`
    );
  }
}

/**
 * Return the validated `INTERNAL_SERVICE_SECRET` for use in outbound
 * `X-Service-Auth` headers. Pairs with `validateInternalServiceSecret()`
 * which runs at process startup — this helper throws loud at call time
 * if the invariant is ever violated (test-mocking edge, hot-reload),
 * rather than letting a `?? ''` fallback silently produce 401s.
 *
 * @throws Error if INTERNAL_SERVICE_SECRET is missing — should be caught
 *   by `validateInternalServiceSecret` at boot, so a throw here indicates
 *   a programming or test-setup error, not a config misconfig.
 */
export function getValidatedServiceSecret(): string {
  const config = getConfig();
  if (config.INTERNAL_SERVICE_SECRET === undefined || config.INTERNAL_SERVICE_SECRET.length === 0) {
    throw new Error(
      'INTERNAL_SERVICE_SECRET not configured — startup validation should have caught this'
    );
  }
  return config.INTERNAL_SERVICE_SECRET;
}

/**
 * Log gateway health check result
 * @param isHealthy Whether the gateway health check passed
 */
export function logGatewayHealthStatus(isHealthy: boolean): void {
  if (!isHealthy) {
    logger.warn('Gateway health check failed, but continuing...');
  } else {
    logger.info('Gateway is healthy');
  }
}
