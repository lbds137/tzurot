/**
 * Shared bounded-retry loop for gateway calls that use the typed `ServiceClient`
 * result union (`GatewayResult<T>`). Three call sites in `gatewayServiceCalls.ts`
 * (`generate`, `reportDeliveries`, `reportNotifyOutcomes`) previously duplicated
 * the same attempt/backoff/retry-log shape; this module is the single copy.
 *
 * Callers own their own success handling and their own terminal ERROR log +
 * return/throw contract — those differ per site (throw vs. return undefined vs.
 * return false, and each has its own log message). Only the retry WARN and the
 * attempt/backoff bookkeeping live here.
 */

import type { GatewayResult } from '@tzurot/clients';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('gatewayRetry');

/** Gateway failures worth retrying: infrastructure states, never 4xx rejections. */
export function isRetryableGatewayFailure(failure: { kind: string; status: number }): boolean {
  return failure.kind === 'network' || failure.kind === 'timeout' || failure.status >= 500;
}

/**
 * The narrower predicate for a NON-IDEMPOTENT call — one that spends money or
 * creates a job. Only `network` qualifies: the connection itself failed, so in
 * the dominant case (nothing listening yet) the request never reached the
 * gateway and no work was started.
 *
 * A `timeout` MAY mean the request was delivered and is still being handled —
 * the AbortSignal is created at the fetch call, so its clock also covers DNS
 * and connect, and we cannot tell the two apart from here. A 5xx is a reply
 * from a gateway that had already begun handling the request. Either can leave
 * a job that exists, so repeating them risks billing twice and answering the
 * user twice; not retrying is the safe direction under that uncertainty.
 *
 * Two consequences worth knowing: `network` also covers a mid-flight reset,
 * where the request DID land (the gateway's request-dedup cache is the only
 * backstop, and only while its window is open); and a deploy window that
 * STALLS rather than refuses the connection surfaces as `timeout`, so this
 * predicate will not retry it and the original symptom could recur in that
 * shape.
 */
export function isConnectionFailure(failure: { kind: string }): boolean {
  return failure.kind === 'network';
}

/** Options accepted by {@link withGatewayRetry}. */
export interface GatewayRetryOptions {
  /** Total attempts, including the first (non-retry) attempt. */
  maxAttempts: number;
  /** Backoff base; actual delay is `baseDelayMs * 2 ** (attempt - 1)`. */
  baseDelayMs: number;
  /** Operation name for the retry WARN log, e.g. "submitting generation job". */
  operation: string;
  /**
   * Call-site fields merged into the retry WARN (a release id, a job id). The
   * WARN moved out of the call sites when this loop was centralized, and
   * without this the correlating id a retry storm is searched by would be lost.
   */
  context?: Record<string, unknown>;
  /**
   * Which failures to retry. Defaults to {@link isRetryableGatewayFailure};
   * a non-idempotent call should pass {@link isConnectionFailure} instead.
   */
  isRetryable?: (failure: { kind: string; status: number }) => boolean;
}

/** What {@link withGatewayRetry} returns: the last result, plus how many tries it took. */
export interface GatewayRetryOutcome<T> {
  result: GatewayResult<T>;
  /**
   * Attempts actually made. Callers log it on the give-up path, where it
   * separates "failed fast on a 4xx" (1) from "exhausted the backoff" (max) —
   * a distinction the status code alone does not carry.
   */
  attempts: number;
}

/**
 * Run `operation` with bounded retry on transient gateway failures. Returns
 * immediately on success. Returns the failure result as-is (never throws) when
 * the failure isn't retryable or attempts are exhausted — the caller decides
 * what "give up" means (throw, return undefined, return false).
 */
export async function withGatewayRetry<T>(
  call: () => Promise<GatewayResult<T>>,
  options: GatewayRetryOptions
): Promise<GatewayRetryOutcome<T>> {
  const {
    maxAttempts,
    baseDelayMs,
    operation,
    context = {},
    isRetryable = isRetryableGatewayFailure,
  } = options;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await call();
    if (result.ok || !isRetryable(result) || attempt === maxAttempts) {
      return { result, attempts: attempt };
    }
    const delayMs = baseDelayMs * 2 ** (attempt - 1);
    logger.warn(
      { ...context, operation, status: result.status, attempt, nextDelayMs: delayMs },
      'Transient gateway failure; retrying'
    );
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  // Unreachable: the loop returns on the maxAttempts-th iteration at the
  // latest. Thrown rather than silently returned so a maxAttempts < 1 caller
  // fails loudly instead of skipping its gateway call altogether.
  throw new Error('withGatewayRetry: maxAttempts must be >= 1');
}
