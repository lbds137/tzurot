/**
 * Result-collapse helpers + `InfraError` — the foundation for distinguishing a
 * genuine negative result (a real 404 / empty set) from an INFRASTRUCTURE
 * failure (timeout / network / 5xx / config / schema) when consuming a
 * `GatewayResult`.
 *
 * The bug class these prevent: a loader returns the SAME sentinel (`null` / `[]`)
 * for "the resource genuinely does not exist" AND "the gateway call failed", and
 * a user-facing command then asserts a definitive "X not found" on what was
 * really a transient blip. (Runtime-confirmed in prod: a `status: 0` transport
 * failure surfaced to a user as "Character not found".)
 *
 * Two collapse strategies, picked by the CALLER's needs:
 *
 *   - **Pattern B** (`nullOn404` / `emptyOn404`): for code that feeds a
 *     user-facing message. `null` / `[]` means DEFINITIVELY absent (a real 404).
 *     An infra failure (5xx / timeout / network) THROWS `InfraError` → the
 *     command framework's "try again" message; a non-404 4xx (the request was
 *     rejected — retrying won't help) THROWS `GatewayClientError` → the generic
 *     error message. The default for terminal command paths.
 *   - **Pattern A** (`nullOnAnyError`): for routing / mention-parsing paths that
 *     intentionally treat "unknown" as "no match" — a transient blip must not
 *     blind routing, so EVERY failure collapses to `null`. Use ONLY where a
 *     definitive negative is not surfaced to the user (and the caller does not
 *     negative-cache the `null`).
 *
 * Decision rule: result feeds a user message → Pattern B; result feeds further
 * logic / routing / aggregation → Pattern A, or thread the `GatewayResult`
 * through and branch on it explicitly.
 *
 * The `status > 0 ⟺ kind === 'http'` invariant (see `GatewayResult`) is what
 * makes `status === 404` an unambiguous "genuine miss": a `status: 0` infra
 * failure can never look like a 404.
 */

import type { GatewayFailureKind } from './errors.js';
import type { GatewayResult } from './transport.js';

/** The failure arm of a `GatewayResult` (kind-independent of the success type). */
type GatewayFailure = Extract<GatewayResult<unknown>, { ok: false }>;

/**
 * A gateway call failed for an INFRASTRUCTURE reason (timeout / network / 5xx /
 * config / schema) — distinct from a genuine 404. Thrown by the Pattern-B
 * collapse helpers so a transient failure surfaces to the user as "try again",
 * never as a definitive "doesn't exist". The command framework's top-level
 * catch recognises it (see bot-client `CommandHandler`).
 */
export class InfraError extends Error {
  /** Failure category — `'http'` (a 5xx; a 4xx becomes {@link GatewayClientError}), else `network`/`timeout`/`config`/`schema`. */
  readonly kind: GatewayFailureKind;
  /** HTTP status for a `'http'` failure (a 5xx); `0` for non-HTTP kinds. */
  readonly status: number;

  constructor(failure: GatewayFailure) {
    super(
      `Gateway infrastructure failure (${failure.kind}, status ${failure.status}): ${failure.error}`
    );
    this.name = 'InfraError';
    this.kind = failure.kind;
    this.status = failure.status;
  }
}

/**
 * A gateway call returned a CLIENT error — a non-404 4xx (400/401/403/409): the
 * request itself was rejected (bad input, no permission, conflict), so retrying
 * the SAME request will NOT help. Distinct from {@link InfraError} (a transient
 * infra failure — retryable, "try again") and from a 404 (genuine absence). The
 * command framework shows its generic error text, not the "try again" message;
 * a caller wanting a resource-specific message (e.g. "you don't have access")
 * can catch this type.
 */
export class GatewayClientError extends Error {
  /** The 4xx status the gateway returned (e.g. 401/403/409). */
  readonly status: number;

  constructor(failure: GatewayFailure) {
    super(`Gateway client error (status ${failure.status}): ${failure.error}`);
    this.name = 'GatewayClientError';
    this.status = failure.status;
  }
}

/**
 * True when a gateway failure is INFRASTRUCTURE (transient / retryable): any
 * non-HTTP kind (`network`/`timeout`/`config`/`schema`, `status: 0`) or an HTTP
 * 5xx. An HTTP 4xx is a CLIENT error — the request was rejected, so retrying the
 * same request won't help; those become {@link GatewayClientError}.
 */
function isInfraFailure(failure: GatewayFailure): boolean {
  return failure.kind !== 'http' || failure.status >= 500;
}

/**
 * Pattern B for single-resource reads. Returns the data on success, `null` ONLY
 * on a genuine 404 — so `null` unambiguously means "the resource does not
 * exist". Other failures throw: {@link InfraError} for an infra failure (5xx /
 * timeout / network — "try again"), {@link GatewayClientError} for a non-404
 * 4xx (the request was rejected — retrying won't help).
 */
export function nullOn404<T>(result: GatewayResult<T>): T | null {
  if (result.ok) {
    return result.data;
  }
  if (result.status === 404) {
    return null;
  }
  if (isInfraFailure(result)) {
    throw new InfraError(result);
  }
  throw new GatewayClientError(result);
}

/**
 * Pattern B for list reads. Returns the array on success, `[]` ONLY on a genuine
 * 404. Other failures throw: {@link InfraError} for an infra failure,
 * {@link GatewayClientError} for a non-404 4xx.
 */
export function emptyOn404<T>(result: GatewayResult<T[]>): T[] {
  if (result.ok) {
    return result.data;
  }
  if (result.status === 404) {
    return [];
  }
  if (isInfraFailure(result)) {
    throw new InfraError(result);
  }
  throw new GatewayClientError(result);
}

/**
 * Pattern A for routing / mention-parsing. Collapses EVERY failure (including
 * infra) to `null` — "treat unknown as no match". Never throws. Use ONLY where a
 * transient failure must not surface a definitive negative to the user and the
 * caller does not negative-cache the `null`.
 */
export function nullOnAnyError<T>(result: GatewayResult<T>): T | null {
  return result.ok ? result.data : null;
}
