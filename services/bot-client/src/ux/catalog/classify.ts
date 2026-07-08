/**
 * Gateway-failure classifier — outcome classification is a function of the
 * ERROR, never a per-call-site choice (design §4.2 composition rule).
 *
 * Call sites pass whatever they caught (or a `GatewayResult` failure arm) plus
 * the resource name; the classifier narrows the transport discriminant
 * (`GatewayFailureKind`) and returns the honest MessageSpec:
 *
 *   timeout | network → outcome-uncertain (the write MAY have applied)
 *   schema            → committed-unconfirmed (200 OK, unreadable body)
 *   http              → definitive rejection; surface the gateway's message
 *   config            → infra-transient
 *   anything else     → generic definitive failure
 *
 * TOTAL by design: never throws, and never leaks a raw `error.message` from
 * an unrecognized error into user-facing text (council-mandated invariant —
 * raw internals reaching users is the PersonalityMessageHandler leak class).
 */

import {
  GatewayApiError,
  GatewayClientError,
  InfraError,
  type GatewayFailureKind,
} from '@tzurot/clients';
import { CATALOG } from './catalog.js';
import type { MessageSpec } from './types.js';

/** The failure arm of a `GatewayResult<T>` (structurally matched — no import cycle). */
export interface GatewayResultFailure {
  ok: false;
  kind: GatewayFailureKind;
  error: string;
  status: number;
}

/** Options forwarded to the uncertain/committed shapes (dashboard Refresh hint). */
export interface ClassifyOptions {
  refreshAffordance?: boolean;
}

function isGatewayResultFailure(input: unknown): input is GatewayResultFailure {
  if (input === null || typeof input !== 'object') {
    return false;
  }
  const obj = input as Record<string, unknown>;
  return obj.ok === false && typeof obj.kind === 'string' && typeof obj.error === 'string';
}

/**
 * Extract the gateway's own user-appropriate message from a thrown wrapper.
 * Two wrapper formats exist (arch rule: the gateway emits user-appropriate
 * JSON messages, so the extracted suffix is safe to surface):
 *   - caller-thrown wrappers: `"Failed to X: {status} - {gateway message}"`
 *   - collapse-helper wrappers: `"Gateway client error (status {n}): {msg}"`
 * Falls back to null when neither matches — callers then use the generic
 * failure line (never the raw message).
 */
const CALLER_WRAPPER_RE = /: \d{3} - (.+)$/;
const COLLAPSE_WRAPPER_RE = /\(status \d{3}\): (.+)$/;

/**
 * Conservative surfaced-message cap — leaves room for the emoji prefix under
 * Discord's 2000-char content limit. Shared with saveError's legacy extractor.
 */
export const MAX_SURFACED_LENGTH = 1800;

function truncateSurfaced(message: string): string {
  return message.length > MAX_SURFACED_LENGTH
    ? `${message.slice(0, MAX_SURFACED_LENGTH)}…`
    : message;
}

function extractGatewayMessage(message: string): string | null {
  const match = CALLER_WRAPPER_RE.exec(message) ?? COLLAPSE_WRAPPER_RE.exec(message);
  if (match === null) {
    return null;
  }
  return truncateSurfaced(match[1]);
}

function specForKind(
  kind: GatewayFailureKind,
  gatewayMessage: string | null,
  resource: string,
  opts: ClassifyOptions
): MessageSpec {
  switch (kind) {
    case 'timeout':
    case 'network':
      return CATALOG.error.uncertainWrite(resource, opts);
    case 'schema':
      return CATALOG.error.committedUnconfirmed(resource, opts);
    case 'http':
      return gatewayMessage !== null
        ? CATALOG.error.gatewayRejection(gatewayMessage)
        : CATALOG.error.operationFailed(`update ${resource}`);
    case 'config':
      return CATALOG.error.transient("Couldn't reach the server right now.");
    default:
      // Unreachable for the typed carriers, but the fail-arm guard only
      // verifies `kind` is a string — a malformed object with an off-union
      // kind must degrade to the generic failure, not return undefined.
      return CATALOG.error.operationFailed(`update ${resource}`);
  }
}

/**
 * Classify a caught gateway failure (or a `GatewayResult` failure arm) into
 * the honest MessageSpec for the given resource.
 *
 * @param input - whatever the call site caught: `GatewayApiError`,
 *   `InfraError`, a `GatewayResult` failure arm, or anything else (total).
 * @param resource - user-facing name of what was being written ("character",
 *   "preset", "memory lock"). Used in the uncertain/failed shapes.
 */
export function classifyGatewayFailure(
  input: unknown,
  resource: string,
  opts: ClassifyOptions = {}
): MessageSpec {
  if (input instanceof InfraError) {
    // InfraError carries the gateway string as a FIELD — its prose wrapper
    // format matches neither extraction regex (review-caught: a real 5xx via
    // nullOn404 would silently lose its gateway detail behind the generic).
    return specForKind(input.kind, truncateSurfaced(input.gatewayMessage), resource, opts);
  }

  if (input instanceof GatewayApiError) {
    return specForKind(input.kind, extractGatewayMessage(input.message), resource, opts);
  }

  if (input instanceof GatewayClientError) {
    // Non-404 4xx from the collapse helpers: definitive rejection (carries
    // status, not kind — http by construction).
    const gatewayMessage = extractGatewayMessage(input.message);
    return gatewayMessage !== null
      ? CATALOG.error.gatewayRejection(gatewayMessage)
      : CATALOG.error.operationFailed(`update ${resource}`);
  }

  if (isGatewayResultFailure(input)) {
    // The fail-arm's `error` IS the gateway message for http kinds (no
    // wrapper prefix to strip) — but it needs the same truncation every other
    // carrier gets (review-caught: a verbose gateway validation error would
    // blow Discord's content cap and the reply would fail to send).
    const gatewayMessage = input.kind === 'http' ? truncateSurfaced(input.error) : null;
    return specForKind(input.kind, gatewayMessage, resource, opts);
  }

  // A plain Error whose message carries the gateway wrapper format
  // ("…: 409 - {gateway message}") is a recognized convention, not unknown
  // internals — several api helpers wrap gateway rejections this way without
  // a typed error class. Only the clean post-status suffix surfaces.
  if (input instanceof Error) {
    const gatewayMessage = extractGatewayMessage(input.message);
    if (gatewayMessage !== null) {
      return CATALOG.error.gatewayRejection(gatewayMessage);
    }
  }

  // Unknown error shape: generic definitive failure. Deliberately does NOT
  // surface `error.message` — unrecognized internals never reach users.
  return CATALOG.error.operationFailed(`update ${resource}`);
}
