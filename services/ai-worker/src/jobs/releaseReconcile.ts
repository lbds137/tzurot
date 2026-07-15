/**
 * Hourly release-reconcile trigger.
 *
 * ai-worker owns the repo's only job scheduler, but the reconcile logic
 * lives in api-gateway (it needs prisma + the broadcast queue). This job is
 * a thin authenticated POST to the internal trigger route; the returned
 * sweep summary lands in the scheduled worker's completed log line, which
 * is what makes an hourly run verifiable in Railway logs.
 */

import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ReleaseReconcileJob');

/** Internal route timeoutMs (30s) + transport headroom. */
const RECONCILE_TIMEOUT_MS = 35_000;

export async function triggerReleaseReconcile(): Promise<unknown> {
  const config = getConfig();
  const gatewayUrl = config.GATEWAY_URL;
  if (gatewayUrl === undefined) {
    throw new Error('GATEWAY_URL not configured — cannot trigger release reconcile');
  }
  const serviceSecret = config.INTERNAL_SERVICE_SECRET;
  if (serviceSecret === undefined || serviceSecret.length === 0) {
    throw new Error(
      'INTERNAL_SERVICE_SECRET not configured — cannot trigger release reconcile (the internal route requires service auth)'
    );
  }

  const response = await fetch(`${gatewayUrl}/api/internal/release-broadcast/reconcile`, {
    method: 'POST',
    headers: { 'X-Service-Auth': serviceSecret, 'content-type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(RECONCILE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Release reconcile trigger failed: HTTP ${response.status}`);
  }

  const summary: unknown = await response.json();
  logger.debug({ summary }, 'Release reconcile summary received');
  return summary;
}
