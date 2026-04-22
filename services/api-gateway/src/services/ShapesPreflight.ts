/**
 * Shapes.inc Session Preflight
 *
 * When a user submits a shapes.inc session cookie via `/shapes auth`, validate
 * it against shapes.inc *before* encrypting and persisting. Without this check,
 * an already-expired cookie would land in the credential store successfully
 * and only surface its invalidity on the user's first `/shapes import` attempt
 * minutes later.
 *
 * Graceful degradation: a 5xx, a 404, or any network/timeout error produces an
 * `inconclusive` outcome — the caller still persists the cookie. A shapes.inc
 * outage must not block users from saving otherwise-valid credentials.
 *
 * Only an explicit 401/403 from shapes.inc is treated as "invalid".
 */

import { createLogger, SHAPES_BASE_URL, SHAPES_USER_AGENT } from '@tzurot/common-types';

const logger = createLogger('ShapesPreflight');

/**
 * Timeout for the preflight request. Generous enough for a slow round-trip
 * but short enough that a shapes.inc outage doesn't stall the user's auth flow
 * for the full gateway-deferred-reply budget.
 */
const PREFLIGHT_TIMEOUT_MS = 5000;

/**
 * `/api/users/info` is a known-to-exist endpoint on shapes.inc (typed
 * response `ShapesIncUserProfile` in `@tzurot/common-types` is already
 * used by the fetcher flow). Council-recommended over `/api/auth/session`
 * (Better Auth convention) because:
 *
 *  1. **Fate-sharing with the actual fetcher surface.** If shapes.inc ever
 *     adds a CSRF or secondary-token requirement to user-data endpoints,
 *     a session-introspection endpoint might still 200 while real imports
 *     fail — a false-positive preflight. Probing the same surface the
 *     fetcher hits means "preflight passes" implies "imports will work."
 *
 *  2. **API canary.** A spike in 4xx/5xx on this endpoint tells us shapes.inc
 *     changed something the fetcher will care about, not just that their
 *     optional session endpoint moved.
 *
 *  3. **Known to exist.** No guesswork. The fetcher's type signatures prove
 *     the endpoint was live at the last observed behavior.
 *
 * Known acceptable trade-offs: `GET /users/info` may update `last_active`
 * timestamps on shapes.inc's side (not strictly read-only), and data
 * endpoints may have stricter rate limits than session endpoints. Both are
 * low-severity for our use case — single preflight per user-initiated
 * `/shapes auth` submit, not a polling loop.
 */
const PREFLIGHT_ENDPOINT = '/api/users/info';

export type PreflightOutcome = 'valid' | 'invalid' | 'inconclusive';

/**
 * Probe shapes.inc with the submitted session cookie and return the outcome.
 * Never throws — network/timeout errors return `'inconclusive'` so the caller
 * can decide whether to proceed.
 */
export async function probeShapesSession(sessionCookie: string): Promise<PreflightOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);

  try {
    const response = await fetch(`${SHAPES_BASE_URL}${PREFLIGHT_ENDPOINT}`, {
      method: 'GET',
      headers: {
        Cookie: sessionCookie,
        'User-Agent': SHAPES_USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    // We only need the status code, not the body. Cancel the body stream
    // so the socket can return to undici's keep-alive pool immediately
    // instead of waiting for GC. Fire-and-forget: cleanup errors mustn't
    // affect the preflight classification outcome. `void` swallows the
    // resolved value; the `.catch` swallows any rejection — without it
    // a cancel-rejection would surface as an unhandled rejection and
    // (Node 18+ default) crash the process.
    void response.body?.cancel().catch(() => undefined);

    if (response.ok) {
      // Log the happy path at info level so observability grep
      // (`| grep ShapesPreflight`) can distinguish "ran and passed" from
      // "never ran." Without this log, a silent `valid` outcome is
      // indistinguishable from the function never firing at all.
      logger.info({ status: response.status }, 'Preflight valid');
      return 'valid';
    }

    if (response.status === 401 || response.status === 403) {
      logger.info({ status: response.status }, 'shapes.inc rejected submitted cookie');
      return 'invalid';
    }

    // 404 (endpoint moved/missing), 5xx (server error), other 4xx (unexpected)
    // → inconclusive. Log loudly so we notice if the endpoint ever changes
    // and always-inconclusive becomes the norm.
    logger.warn(
      { status: response.status, endpoint: PREFLIGHT_ENDPOINT },
      'Inconclusive preflight — persisting cookie anyway'
    );
    return 'inconclusive';
  } catch (error) {
    // AbortError (timeout), network errors (ENOTFOUND, ECONNRESET, etc.) all
    // collapse to inconclusive — we don't want a shapes.inc outage to block
    // users from saving valid credentials.
    logger.warn(
      { err: error instanceof Error ? error : new Error(String(error)) },
      'Preflight fetch failed — persisting cookie anyway'
    );
    return 'inconclusive';
  } finally {
    clearTimeout(timeout);
  }
}
