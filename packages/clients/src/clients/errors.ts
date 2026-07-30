/**
 * Gateway client error types + parsing helpers.
 *
 * Lifted from services/bot-client/src/utils/userGatewayClient.ts so both
 * the legacy bot-client wrappers and the new generated clients reference
 * the same error shape. The class identity matters — callers do
 * `instanceof GatewayApiError`, so any duplicate definition would break
 * that check at the package boundary.
 */

import { z } from 'zod';
import type { ApiErrorSubcode } from '@tzurot/common-types/constants/error';

/**
 * Transport failure category. Defined here (the dependency target) rather than
 * in transport.ts so `GatewayApiError` can carry it without a transport↔errors
 * import cycle; transport.ts imports it back for the `GatewayResult` envelope.
 * The four non-HTTP kinds all carry `status: 0`; only `'http'` carries a real
 * HTTP status (invariant: `status > 0 ⟺ kind === 'http'`).
 */
export type GatewayFailureKind = 'config' | 'network' | 'timeout' | 'schema' | 'http';

/**
 * Wire shape of a gateway error body. Used by {@link parseErrorResponse}
 * to validate the JSON body via Zod rather than an unsafe cast — same
 * defensive validation the transport's success-path schema check
 * provides, applied symmetrically to the error path.
 *
 * All three fields are optional because some error responses ship from
 * upstream middleware (nginx HTML pages, CDN errors, etc.) and won't
 * carry the structured shape — those fall through to the "HTTP <status>"
 * fallback.
 *
 * Note on `code`: typed as `z.string()` rather than `z.nativeEnum(
 * API_ERROR_SUBCODE)` to mirror the legacy cast's permissiveness — the
 * gateway may add new subcodes in versions ahead of the bot-client's
 * common-types version, and a strict enum check would mis-classify
 * those as malformed bodies and drop the message context. The narrower
 * `ApiErrorSubcode` typing is reasserted at the consumer boundary.
 */
const ErrorBodySchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional(),
    code: z.string().optional(),
  })
  .passthrough();

/**
 * Parsed shape of a gateway error response body.
 *
 * - `message` is human-readable (falls back to "HTTP <status>" if the
 *   body isn't JSON).
 * - `code` is the optional machine-readable sub-code from the
 *   `ApiErrorSubcode` union. Callers should branch on this rather than
 *   regex-matching the message.
 */
export interface ParsedErrorResponse {
  message: string;
  code?: ApiErrorSubcode;
  /**
   * Raw response body, truncated to {@link RAW_ERROR_BODY_MAX_CHARS}. Set ONLY
   * when the body could not be read as a structured gateway error. Absent when
   * the gateway's own JSON shape parsed (its `message` already carries the
   * detail) and when the body was empty.
   *
   * Two distinct triggers, and the second is easy to overlook:
   *   1. The body is not JSON at all — an nginx 502 page, a CDN HTML block
   *      page, a proxy's plain-text complaint. This is the intended target.
   *   2. The body IS a JSON object but a present field has the wrong type
   *      (`{"message": 123}`). `ErrorBodySchema` is passthrough with every
   *      field optional, so this is the only way a JSON body fails it — but
   *      it means a JSON-shaped body can reach the log raw. Narrow, not
   *      impossible.
   *
   * For operator logs, never for user-facing text: the user still sees
   * `HTTP <status>`. Callers forward it into structured logging so "why did
   * the gateway 502?" has an answer beyond the status code.
   */
  rawText?: string;
}

/**
 * Error thrown by higher-level API client functions when a gateway call
 * returns a non-ok response. Carries the HTTP `status` and, when the
 * gateway set one, the machine-readable `code` sub-classifier so
 * retry/branching logic can match on the code instead of the message.
 *
 * Property names mirror the `GatewayError` wire shape (`status`, `code`)
 * so propagation through the result-object → thrown-error boundary needs
 * no renaming.
 */
export class GatewayApiError extends Error {
  public readonly status: number;
  /**
   * Transport failure category propagated from `GatewayResult`, so try/catch
   * callers can branch on `'timeout'` vs `'network'` vs `'schema'` without
   * string-matching `message` — the same distinction the result path gets.
   * Required (not optional): every construction site has the result's `kind`
   * in hand, so callers can write an exhaustive `switch (err.kind)` with no
   * null-branch.
   */
  public readonly kind: GatewayFailureKind;
  public readonly code?: ApiErrorSubcode;
  /**
   * Raw Zod validation problems, forwarded from `GatewayResult` — only set when
   * `kind === 'schema'`. Mirrors the result path so try/catch callers can inspect
   * contract drift structurally instead of re-parsing `message`.
   */
  public readonly issues?: z.ZodIssue[];

  constructor(
    message: string,
    status: number,
    kind: GatewayFailureKind,
    code?: ApiErrorSubcode,
    issues?: z.ZodIssue[]
  ) {
    super(message);
    this.name = 'GatewayApiError';
    this.status = status;
    this.kind = kind;
    this.code = code;
    this.issues = issues;
  }
}

/**
 * Cap on the retained {@link ParsedErrorResponse.rawText}. Upstream error pages
 * are unbounded (an nginx default 502 page is small, but a CDN block page or a
 * verbose proxy trace is not), and this string lands in a structured log line
 * on every failed request — enough to identify the responder, not enough to
 * flood the log.
 */
const RAW_ERROR_BODY_MAX_CHARS = 512;

/**
 * Truncate without splitting a surrogate pair. `String.prototype.slice` cuts by
 * UTF-16 code unit, so a cut landing between the halves of an astral character
 * (an emoji in an upstream error page) would emit a lone surrogate into the log.
 * Dropping the orphaned leading half costs one character of an excerpt that is
 * already explicitly an excerpt.
 */
function truncateForLog(text: string): string {
  // No length guard: `slice` already no-ops on a short string, and the orphan
  // check cannot misfire on one. A decoded body is well-formed UTF-16 (the
  // decoder substitutes U+FFFD for malformed bytes), so its final code unit is
  // never a lone HIGH surrogate — only a cut we make ourselves can orphan one.
  // `charCodeAt` on an empty string yields NaN, which compares false.
  const cut = text.slice(0, RAW_ERROR_BODY_MAX_CHARS);
  const lastUnit = cut.charCodeAt(cut.length - 1);
  const endsOnOrphanedHighSurrogate = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return endsOnOrphanedHighSurrogate ? cut.slice(0, -1) : cut;
}

/**
 * Parse error from API response. Returns the human-readable message, the
 * optional machine-readable sub-code, and — when the body wasn't a structured
 * gateway error — the raw body text for operator logs. Falls back to
 * `HTTP <status>` for the message when the body isn't the expected JSON.
 *
 * Reads the body as TEXT and parses that, rather than calling `response.json()`
 * directly: a `Response` body is a single-use stream, so a failed `.json()`
 * leaves nothing for a later `.text()` to recover. Text-first is what makes
 * `rawText` reachable on the very paths that need it.
 *
 * The gateway only emits `code` values from the `ApiErrorSubcode` union.
 * Unrecognized strings on the wire would type-widen to `string`, but in
 * practice both sides compile against the same `@tzurot/common-types`
 * version so the cast is safe.
 *
 * @param sanitizeBody Applied to the FULL body before truncation, for callers
 *   that must keep specific strings out of the log. Order is the whole point:
 *   sanitizing the truncated excerpt instead would miss a value straddling the
 *   cutoff, since a partial string no longer matches the string being removed —
 *   leaving a fragment of it in the log. Doing it here, inside the function
 *   that owns the truncation, keeps "rawText is sanitized AND bounded" a single
 *   invariant rather than two call-site obligations that can be sequenced wrong.
 */
export async function parseErrorResponse(
  response: Response,
  sanitizeBody?: (fullBody: string) => string
): Promise<ParsedErrorResponse> {
  const fallback = `HTTP ${response.status}`;

  let text: string;
  try {
    text = await response.text();
  } catch {
    // Body stream unreadable (connection dropped mid-response). There is no
    // body to report — the status is all the information that exists.
    return { message: fallback };
  }

  // An empty body carries no diagnostic value; omit rawText rather than
  // logging an empty field on every bodyless 4xx.
  const unstructured =
    text.length === 0
      ? { message: fallback }
      : { message: fallback, rawText: truncateForLog(sanitizeBody?.(text) ?? text) };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return unstructured;
  }

  const parsed = ErrorBodySchema.safeParse(raw);
  if (!parsed.success) {
    // Body parsed as JSON but didn't match the expected error shape
    // (e.g. nginx returned a different JSON envelope). Fall back to
    // the status-derived message — callers branch on `status`, not
    // the message text — and keep the body for operators.
    return unstructured;
  }
  // Prefer message (human-readable) over error (code like "VALIDATION_ERROR")
  const message = parsed.data.message ?? parsed.data.error ?? fallback;
  return { message, code: parsed.data.code as ApiErrorSubcode | undefined };
}
