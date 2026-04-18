/**
 * Gateway Client
 * Centralized API client for communicating with the API Gateway
 *
 * Provides:
 * - Service-to-service authentication (X-Service-Auth header)
 * - User identification context (X-User-Id, X-User-Username, X-User-DisplayName)
 * - Standardized error handling
 * - Gateway URL validation
 */

import type { User as DiscordUser } from 'discord.js';
import {
  getConfig,
  createLogger,
  CONTENT_TYPES,
  GATEWAY_TIMEOUTS,
  type ApiErrorSubcode,
  type GatewayUser,
} from '@tzurot/common-types';

const logger = createLogger('gateway-client');

// Re-export GATEWAY_TIMEOUTS for existing consumers
export { GATEWAY_TIMEOUTS };

// Re-export GatewayUser so bot-client callers have a single import site.
// The interface itself lives in common-types — PR B's gateway middleware
// will import from the same source, giving both sides one contract.
export type { GatewayUser };

/**
 * Gateway API response wrapper
 */
interface GatewayResponse<T> {
  ok: true;
  data: T;
}

interface GatewayError {
  ok: false;
  error: string;
  status: number;
  /**
   * Machine-readable error sub-code when the gateway sets one, e.g.
   * 'NAME_COLLISION'. Callers should branch on this instead of regex-
   * matching {@link GatewayError.error} whenever the sub-code exists.
   * Same name as {@link GatewayApiError.code} so renaming through the
   * error-propagation chain is unnecessary.
   */
  code?: ApiErrorSubcode;
}

type GatewayResult<T> = GatewayResponse<T> | GatewayError;

/**
 * Error thrown by higher-level API client functions (e.g. `createPreset`)
 * when a gateway call returns a non-ok response. Carries the HTTP `status`
 * and, when the gateway set one, the machine-readable `code` sub-classifier
 * so retry/branching logic can match on the code instead of the message.
 */
export class GatewayApiError extends Error {
  public readonly status: number;
  public readonly code?: ApiErrorSubcode;

  constructor(message: string, status: number, code?: ApiErrorSubcode) {
    super(message);
    this.name = 'GatewayApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Build a `GatewayUser` from a Discord.js `User` object. Centralizes the
 * `globalName ?? username` fallback — callers never decide locally.
 * Works for both `interaction.user` and `message.author` (both are `User`).
 */
export function toGatewayUser(user: DiscordUser): GatewayUser {
  return {
    discordId: user.id,
    username: user.username,
    displayName: user.globalName ?? user.username,
  };
}

/**
 * Options for gateway API calls
 */
interface GatewayCallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  user: GatewayUser;
  body?: unknown;
  /**
   * Request timeout in milliseconds.
   * Defaults to GATEWAY_TIMEOUTS.AUTOCOMPLETE (2500ms) for backward compatibility.
   * Use GATEWAY_TIMEOUTS.DEFERRED (10000ms) for deferred slash commands.
   */
  timeout?: number;
}

/**
 * Get the gateway URL, throwing if not configured
 */
export function getGatewayUrl(): string {
  const config = getConfig();
  const gatewayUrl = config.GATEWAY_URL;

  if (gatewayUrl === undefined || gatewayUrl.length === 0) {
    throw new Error('GATEWAY_URL not configured');
  }

  return gatewayUrl;
}

/**
 * Check if gateway is configured (non-throwing version)
 */
export function isGatewayConfigured(): boolean {
  try {
    getGatewayUrl();
    return true;
  } catch {
    return false;
  }
}

/**
 * Parsed shape of a gateway error response body.
 * `message` is human-readable; `code` is the optional machine-readable
 * sub-code (see {@link GatewayApiError.code} and `ApiErrorSubcode` in
 * common-types).
 */
export interface ParsedErrorResponse {
  message: string;
  code?: ApiErrorSubcode;
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
    const data = (await response.json()) as {
      error?: string;
      message?: string;
      code?: ApiErrorSubcode;
    };
    // Prefer message (human-readable) over error (code like "VALIDATION_ERROR")
    const message = data.message ?? data.error ?? `HTTP ${response.status}`;
    return { message, code: data.code };
  } catch {
    return { message: `HTTP ${response.status}` };
  }
}

/**
 * Call the gateway API with consistent auth and error handling
 *
 * @param path - API path (e.g., '/user/llm-config')
 * @param options - Request options including `user` context for auth + provisioning
 * @returns GatewayResult with typed data or error
 */
export async function callGatewayApi<T>(
  path: string,
  options: GatewayCallOptions
): Promise<GatewayResult<T>> {
  const { method = 'GET', user, body, timeout = GATEWAY_TIMEOUTS.AUTOCOMPLETE } = options;

  try {
    const gatewayUrl = getGatewayUrl();
    const config = getConfig();

    // URI-encode `username` and `displayName` because Node's `fetch` encodes
    // HTTP header values as Latin-1; any non-Latin-1 char (emoji in display
    // names are very common) throws synchronously. Gateway middleware in
    // PR B decodes these on arrival. `X-User-Id` is safe raw: Discord
    // snowflakes are digits only, always Latin-1.
    const headers: Record<string, string> = {
      'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
      'X-User-Id': user.discordId,
      'X-User-Username': encodeURIComponent(user.username),
      'X-User-DisplayName': encodeURIComponent(user.displayName),
    };

    if (body !== undefined) {
      headers['Content-Type'] = CONTENT_TYPES.JSON;
    }

    const response = await fetch(`${gatewayUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const parsed = await parseErrorResponse(response);
      logger.warn(
        { path, method, status: response.status, userId: user.discordId },
        '[Gateway] Request failed'
      );
      return {
        ok: false,
        error: parsed.message,
        status: response.status,
        code: parsed.code,
      };
    }

    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (error) {
    // Extract useful error info for logging
    const isAbortError = error instanceof DOMException && error.name === 'TimeoutError';
    const errorMessage = isAbortError
      ? 'Request timeout (gateway slow or unavailable)'
      : error instanceof Error
        ? error.message
        : 'Unknown error';

    logger.warn(
      { path, method, userId: user.discordId, errorMessage, isTimeout: isAbortError },
      '[Gateway] Request error'
    );
    return { ok: false, error: errorMessage, status: 0 };
  }
}
