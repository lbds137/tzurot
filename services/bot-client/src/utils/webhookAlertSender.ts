/**
 * Shared best-effort owner-alert webhook sender.
 *
 * POSTs `{ content }` JSON to a Discord webhook — the same channel the
 * gateway watchdog alerts on — for callers that must not depend on the
 * Discord gateway being usable: a boot-path alert fires before login, and a
 * wedge alert fires while the gateway is wedged.
 *
 * The sender never throws or rejects, so a failed alert cannot break the
 * caller's own recovery path. Through the gateway watchdog's wrapper, the
 * rejecting-fetch, synchronously-throwing-fetch, and non-OK shapes are
 * pinned by its tests; this module's own tests pin the same shapes directly.
 */
import type { createLogger } from '@tzurot/common-types/utils/logger';

type Logger = ReturnType<typeof createLogger>;

/**
 * Ceiling on a single alert POST. The alert is best-effort context for a
 * human, never a precondition for the caller's recovery, so it must not
 * meaningfully delay it.
 */
export const WEBHOOK_ALERT_TIMEOUT_MS = 2500;

export type WebhookAlertSender = (content: string) => Promise<void>;

/**
 * Build the sender. An unset or blank webhook URL yields a no-op sender —
 * alerting is unconfigured, not broken. `source` labels the caller as a
 * structured field in BOTH failure warns (default 'unknown'), so a failed
 * wedge alert and a failed boot-ban alert read apart in the platform logs.
 */
export function createWebhookAlertSender(
  logger: Logger,
  alertWebhookUrl: string | undefined,
  options?: { fetchFn?: typeof fetch; timeoutMs?: number; source?: string }
): WebhookAlertSender {
  const fetchFn = options?.fetchFn ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? WEBHOOK_ALERT_TIMEOUT_MS;
  const source = options?.source ?? 'unknown';
  return async (content: string): Promise<void> => {
    if (alertWebhookUrl === undefined || alertWebhookUrl.trim() === '') {
      return;
    }
    try {
      const response = await fetchFn(alertWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        // A revoked or misconfigured webhook fails as an HTTP status, not a
        // rejection — without this branch a permanently dead webhook would be
        // indistinguishable from a delivered alert.
        logger.warn(
          { source, status: response.status },
          'Owner-alert webhook returned a non-OK status'
        );
      }
      // Release the socket — an unread response body holds it until GC. The
      // cancel failure is swallowed so it can never escape the fail-open
      // contract.
      await response.body?.cancel().catch(() => undefined);
    } catch (err: unknown) {
      logger.warn({ source, err }, 'Owner-alert webhook POST failed');
    }
  };
}
