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
 * Parse error from API response. Returns both the human-readable message
 * and the optional machine-readable sub-code. Falls back to `HTTP <status>`
 * for the message when the body isn't JSON.
 *
 * The gateway only emits `code` values from the `ApiErrorSubcode` union.
 * Unrecognized strings on the wire would type-widen to `string`, but in
 * practice both sides compile against the same `@tzurot/common-types`
 * version so the cast is safe.
 */
export async function parseErrorResponse(response: Response): Promise<ParsedErrorResponse> {
  try {
    const raw: unknown = await response.json();
    const parsed = ErrorBodySchema.safeParse(raw);
    if (!parsed.success) {
      // Body parsed as JSON but didn't match the expected error shape
      // (e.g. nginx returned a different JSON envelope). Fall back to
      // the status-derived message — callers branch on `status`, not
      // the message text.
      return { message: `HTTP ${response.status}` };
    }
    // Prefer message (human-readable) over error (code like "VALIDATION_ERROR")
    const message = parsed.data.message ?? parsed.data.error ?? `HTTP ${response.status}`;
    return { message, code: parsed.data.code as ApiErrorSubcode | undefined };
  } catch {
    return { message: `HTTP ${response.status}` };
  }
}
