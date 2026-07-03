/**
 * Shared gateway transport — fetch wrapper used by every generated client.
 *
 * Hoists the URI-encoding rules, `AbortSignal.timeout` composition, and
 * error-shape handling from the legacy `userGatewayClient.callGatewayApi`
 * into `@tzurot/clients` so all consumers (bot-client today; ai-worker /
 * api-gateway internal callers tomorrow) share one implementation.
 *
 * Three things this layer is responsible for:
 *
 *   1. Service-secret auth header injection (X-Service-Auth).
 *   2. Caller-supplied headers passed through unchanged. The Latin-1-safe
 *      encoding of user-context fields lives in generated client method
 *      bodies (see `packages/tooling/src/codegen/method-builder.ts`)
 *      — they apply `encodeURIComponent` to `X-User-Username` /
 *      `X-User-DisplayName` before passing them here. Node's `fetch`
 *      synchronously throws on non-Latin-1 header values (emoji in
 *      display names are very common), so direct `callGateway` callers
 *      are responsible for their own encoding of any non-ASCII header
 *      they add via `extraHeaders`.
 *   3. Optional Zod response validation. Generated client method bodies
 *      pass `routeDef.output` here; the transport calls `.safeParse()`
 *      on the JSON body. This catches contract drift at the boundary
 *      instead of letting bad data flow into UI code.
 *
 * What this layer is NOT responsible for:
 *
 *   - Config reading. Callers inject `baseUrl` + `serviceSecret`.
 *     common-types must not depend on bot-client's `getConfig()`.
 *   - Path interpolation (`:slug` → `actual-slug`). Generated clients
 *     interpolate before calling the transport.
 *   - Retry, deduplication, caching. Those are concerns of the layers
 *     above (DenylistCache, VoiceTranscriptionService, BullMQ).
 */

import type { z } from 'zod';
import { GATEWAY_TIMEOUTS } from '@tzurot/common-types/constants/discord';
import { type ApiErrorSubcode } from '@tzurot/common-types/constants/error';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { isTimeoutError } from '@tzurot/common-types/utils/errors';
import { GatewayApiError, type GatewayFailureKind, parseErrorResponse } from './errors.js';

/**
 * Result envelope mirroring the legacy `callGatewayApi` discriminated union.
 *
 * The `kind` discriminant lets callers branch on the failure *category* without
 * string-matching `error`. The four non-HTTP kinds all carry `status: 0`; only
 * `kind: 'http'` carries a real HTTP status, so the invariant is
 * `status > 0  ⟺  kind === 'http'`. `code` and `issues` are likewise
 * kind-scoped: `code` is an HTTP-layer subcode (only meaningful for `'http'`),
 * and `issues` holds the raw Zod problems (only populated for `'schema'`).
 * `GatewayFailureKind` lives in `./errors.js` (cycle-avoidance) and reaches
 * `@tzurot/clients` consumers via that module's barrel export.
 */
export type GatewayResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** Failure category — branch on this instead of string-matching `error`. */
      kind: GatewayFailureKind;
      error: string;
      /** HTTP status when `kind === 'http'`; `0` for every other kind. */
      status: number;
      /** HTTP-layer error subcode; only set for `kind === 'http'`. */
      code?: ApiErrorSubcode;
      /**
       * Raw Zod validation problems. Set for the schema-VALIDATION sub-case of
       * `kind === 'schema'`; `undefined` for the JSON-PARSE sub-case (a 2xx body
       * that isn't valid JSON has no Zod issues to report). Both sub-cases mean
       * the same thing — "write committed, response unreadable".
       */
      issues?: z.ZodIssue[];
    };

/** Options accepted by {@link callGateway}. */
export interface TransportOptions {
  /** Full gateway base URL, e.g. `https://api-gateway.example.com`. */
  baseUrl: string;
  /** Shared service secret (sent as X-Service-Auth). */
  serviceSecret: string;
  /** HTTP method. */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Already-interpolated path, e.g. `/api/user/personality/my-slug`. */
  path: string;
  /** Additional headers (user context, request ID, etc.). */
  headers?: Record<string, string>;
  /** Request body — JSON-serialized if defined. */
  body?: unknown;
  /** Request timeout in milliseconds (default: DEFERRED for reads, WRITE for writes). */
  timeoutMs?: number;
  /**
   * Optional Zod schema for the success-path response. When supplied,
   * `data` is validated and any failure surfaces as `{ ok: false, ... }`
   * with status 0 (no HTTP error, just contract drift).
   *
   * WARNING: when omitted, the response body is returned as `data` via an
   * unchecked `as T` cast — there is NO runtime contract enforcement. Generated
   * clients always pass `routeDef.output`, so this only bites direct callers of
   * `callGateway` / `callGatewayOrThrow` that skip the schema. Omit only when
   * the body is genuinely opaque (e.g. a passthrough proxy); otherwise pass one.
   */
  outputSchema?: z.ZodTypeAny;
  /** Optional logger callback for diagnostics. Avoids hard dep on pino. */
  onWarn?: (fields: Record<string, unknown>, message: string) => void;
}

/**
 * Classify an error thrown by `fetch` into the failure envelope: a timeout
 * (the `AbortSignal.timeout` fired) vs a genuine network error (DNS/TLS/reset).
 * Kept separate from {@link callGateway} so the main request flow stays under
 * the cognitive-complexity budget.
 */
function classifyThrownError(error: unknown): {
  kind: 'timeout' | 'network';
  error: string;
} {
  const isAbort = isTimeoutError(error);
  const message = isAbort
    ? 'Request timeout (gateway slow or unavailable)'
    : error instanceof Error
      ? error.message
      : 'Unknown error';
  return { kind: isAbort ? 'timeout' : 'network', error: message };
}

/**
 * Read and (optionally) schema-validate a 2xx response body. A body that isn't
 * valid JSON (204 No Content, a CDN HTML error page, …) and a Zod validation
 * failure are BOTH contract violations, so both surface as `kind: 'schema'`
 * with `status: 0` — never as `'network'`, which a retry loop would wrongly
 * treat as transient and retry forever. Extracted so `callGateway` stays under
 * the cognitive-complexity budget.
 */
async function readValidatedBody(args: {
  response: Response;
  outputSchema: z.ZodTypeAny | undefined;
  onWarn: TransportOptions['onWarn'];
  path: string;
  method: string;
}): Promise<{ ok: true; data: unknown } | { ok: false; result: GatewayResult<never> }> {
  const { response, outputSchema, onWarn, path, method } = args;

  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'parse error';
    onWarn?.({ path, method, kind: 'schema', error: detail }, 'Response body is not valid JSON');
    return {
      ok: false,
      result: {
        ok: false,
        kind: 'schema',
        error: `Response body is not valid JSON: ${detail}`,
        status: 0,
      },
    };
  }

  if (outputSchema === undefined) {
    return { ok: true, data: json };
  }

  const validation = outputSchema.safeParse(json);
  if (!validation.success) {
    onWarn?.(
      { path, method, kind: 'schema', issues: validation.error.issues },
      'Response schema validation failed'
    );
    return {
      ok: false,
      result: {
        ok: false,
        kind: 'schema',
        error: `Response schema validation failed: ${validation.error.message}`,
        status: 0,
        issues: validation.error.issues,
      },
    };
  }
  return { ok: true, data: validation.data };
}

/**
 * Make a single gateway request. Returns a `GatewayResult` envelope; the
 * caller decides whether to throw or branch.
 *
 * Generated clients are the primary caller. Legacy code paths can continue
 * to call this directly during the migration to typed clients.
 */
export async function callGateway<T>(options: TransportOptions): Promise<GatewayResult<T>> {
  const {
    baseUrl,
    serviceSecret,
    method,
    path,
    headers: extraHeaders,
    body,
    timeoutMs,
    outputSchema,
    onWarn,
  } = options;

  // Method-aware default: mutations default to the WRITE budget (20s), reads to
  // the DEFERRED budget (10s). Reads default to DEFERRED — not the tight 2.5s
  // AUTOCOMPLETE budget — because almost every read is invoked from a DEFERRED
  // slash command (15-min window); the tight default silently aborted heavy
  // deferred reads under load. The AUTOCOMPLETE budget is now an explicit opt-in
  // for the few autocomplete-invoked routes (guarded in routes/manifest.test.ts).
  // An explicit `timeoutMs` on the route always wins.
  const isWriteMethod = ['post', 'put', 'patch', 'delete'].includes(method.toLowerCase());
  const effectiveTimeoutMs =
    timeoutMs ?? (isWriteMethod ? GATEWAY_TIMEOUTS.WRITE : GATEWAY_TIMEOUTS.DEFERRED);

  if (baseUrl.length === 0) {
    return { ok: false, kind: 'config', error: 'baseUrl is empty', status: 0 };
  }

  // Strip a single trailing slash so a misconfigured `GATEWAY_URL=...example.test/`
  // doesn't produce `example.test//api/...` (nginx and many CDN configs reject
  // double-slash paths). All `path` values from generated clients start with
  // `/`, so this concatenation is well-formed in either case.
  const normalizedBase = baseUrl.replace(/\/$/, '');

  try {
    const headers: Record<string, string> = {
      'X-Service-Auth': serviceSecret,
      ...(extraHeaders ?? {}),
    };

    if (body !== undefined) {
      headers['Content-Type'] = CONTENT_TYPES.JSON;
    }

    const response = await fetch(`${normalizedBase}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(effectiveTimeoutMs),
    });

    if (!response.ok) {
      const parsed = await parseErrorResponse(response);
      onWarn?.({ path, method, kind: 'http', status: response.status }, 'Request failed');
      return {
        ok: false,
        kind: 'http',
        error: parsed.message,
        status: response.status,
        code: parsed.code,
      };
    }

    const parsed = await readValidatedBody({ response, outputSchema, onWarn, path, method });
    if (!parsed.ok) {
      return parsed.result;
    }
    return { ok: true, data: parsed.data as T };
  } catch (error) {
    const { kind, error: errorMessage } = classifyThrownError(error);
    // Pass `kind` (not a collapsed boolean) so log consumers keep the
    // network-vs-timeout distinction; `error` field name matches the HTTP path.
    onWarn?.({ path, method, error: errorMessage, kind }, 'Request error');
    return { ok: false, kind, error: errorMessage, status: 0 };
  }
}

/**
 * Throwing variant: same contract as {@link callGateway}, but rejects
 * with `GatewayApiError` on non-ok responses. Useful for command handlers
 * that prefer try/catch over discriminated-union branching.
 */
export async function callGatewayOrThrow<T>(options: TransportOptions): Promise<T> {
  const result = await callGateway<T>(options);
  if (!result.ok) {
    throw new GatewayApiError(result.error, result.status, result.kind, result.code, result.issues);
  }
  return result.data;
}
