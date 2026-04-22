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
 * The Better Auth convention is to expose a session-introspection endpoint at
 * `/api/auth/session` that returns the decoded session on valid, or a 401 on
 * invalid/expired. If shapes.inc ever moves it, update this constant — the
 * `inconclusive` outcome on 404 keeps the auth flow working in the meantime.
 */
const PREFLIGHT_ENDPOINT = '/api/auth/session';

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
