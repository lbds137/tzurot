/**
 * Gateway Client
 * Centralized API client for communicating with the API Gateway
 *
 * Provides:
 * - Service-to-service authentication (X-Service-Auth header)
 * - User identification (X-User-Id header)
 * - Standardized error handling
 * - Gateway URL validation
 */

import { getConfig, createLogger, CONTENT_TYPES } from '@tzurot/common-types';

const logger = createLogger('gateway-client');

/**
 * Gateway request timeout constants
 *
 * Different Discord interactions have different time constraints:
 * - Autocomplete: Must respond within 3s (we use 2.5s to leave buffer)
 * - Deferred commands: Have up to 15 minutes after deferral
 */
export const GATEWAY_TIMEOUTS = {
  /**
   * For autocomplete and immediate responses.
   * Discord's limit is 3000ms; we use 2500ms to allow 500ms for overhead.
   */
  AUTOCOMPLETE: 2500,

  /**
   * For deferred slash commands where user sees "Bot is thinking..."
   * More lenient to handle cold starts and slower operations.
   */
  DEFERRED: 10000,
} as const;

/**
 * Gateway API response wrapper
 */
export interface GatewayResponse<T> {
  ok: true;
  data: T;
}

export interface GatewayError {
  ok: false;
  error: string;
  status: number;
}

export type GatewayResult<T> = GatewayResponse<T> | GatewayError;

/**
 * Options for gateway API calls
 */
export interface GatewayCallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  userId: string;
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
 * Parse error from API response
 */
export async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string; message?: string };
    // Prefer message (human-readable) over error (code like "VALIDATION_ERROR")
    return data.message ?? data.error ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/**
 * Call the gateway API with consistent auth and error handling
 *
 * @param path - API path (e.g., '/user/llm-config')
 * @param options - Request options including userId for auth
 * @returns GatewayResult with typed data or error
 */
export async function callGatewayApi<T>(
  path: string,
  options: GatewayCallOptions
): Promise<GatewayResult<T>> {
  const { method = 'GET', userId, body, timeout = GATEWAY_TIMEOUTS.AUTOCOMPLETE } = options;

  try {
    const gatewayUrl = getGatewayUrl();
    const config = getConfig();

    const headers: Record<string, string> = {
      'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
      'X-User-Id': userId,
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
      const error = await parseErrorResponse(response);
      logger.warn({ path, method, status: response.status, userId }, '[Gateway] Request failed');
      return { ok: false, error, status: response.status };
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
      { path, method, userId, errorMessage, isTimeout: isAbortError },
      '[Gateway] Request error'
    );
    return { ok: false, error: errorMessage, status: 0 };
  }
}
