/**
 * Shared gateway transport — fetch wrapper used by every generated client.
 *
 * Hoists the URI-encoding rules, `AbortSignal.timeout` composition, and
 * error-shape handling from the legacy `userGatewayClient.callGatewayApi`
 * into common-types so all consumers (bot-client today; ai-worker /
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

import { isTimeoutError } from '../utils/errors.js';
import { GatewayApiError, parseErrorResponse } from './errors.js';
import { CONTENT_TYPES, GATEWAY_TIMEOUTS } from '../constants/index.js';
import type { ApiErrorSubcode } from '../constants/error.js';

/** Result envelope mirroring the legacy `callGatewayApi` discriminated union. */
export type GatewayResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      status: number;
      code?: ApiErrorSubcode;
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
  /** Request timeout in milliseconds (default: AUTOCOMPLETE). */
  timeoutMs?: number;
  /**
   * Optional Zod schema for the success-path response. When supplied,
   * `data` is validated and any failure surfaces as `{ ok: false, ... }`
   * with status 0 (no HTTP error, just contract drift).
   */
  outputSchema?: z.ZodTypeAny;
  /** Optional logger callback for diagnostics. Avoids hard dep on pino. */
  onWarn?: (fields: Record<string, unknown>, message: string) => void;
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
    timeoutMs = GATEWAY_TIMEOUTS.AUTOCOMPLETE,
    outputSchema,
    onWarn,
  } = options;

  if (baseUrl.length === 0) {
    return { ok: false, error: 'baseUrl is empty', status: 0 };
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
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const parsed = await parseErrorResponse(response);
      onWarn?.({ path, method, status: response.status }, 'Request failed');
      return {
        ok: false,
        error: parsed.message,
        status: response.status,
        code: parsed.code,
      };
    }

    const json = await response.json();

    if (outputSchema !== undefined) {
      const validation = outputSchema.safeParse(json);
      if (!validation.success) {
        onWarn?.(
          {
            path,
            method,
            issues: validation.error.issues,
          },
          'Response schema validation failed'
        );
        return {
          ok: false,
          error: `Response schema validation failed: ${validation.error.message}`,
          status: 0,
        };
      }
      return { ok: true, data: validation.data as T };
    }

    return { ok: true, data: json as T };
  } catch (error) {
    const isAbort = isTimeoutError(error);
    const errorMessage = isAbort
      ? 'Request timeout (gateway slow or unavailable)'
      : error instanceof Error
        ? error.message
        : 'Unknown error';

    onWarn?.({ path, method, errorMessage, isTimeout: isAbort }, 'Request error');
    return { ok: false, error: errorMessage, status: 0 };
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
    throw new GatewayApiError(result.error, result.status, result.code);
  }
  return result.data;
}
