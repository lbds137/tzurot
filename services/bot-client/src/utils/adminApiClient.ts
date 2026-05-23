/**
 * Admin API Client
 *
 * Centralized utility for making authenticated requests to admin endpoints.
 * Automatically includes the X-Service-Auth header for service-to-service authentication.
 *
 * IMPORTANT: Pass `userId` for any route that needs caller identity — either
 * for isBotOwner() checks (e.g., /admin/settings) or for per-user server-side
 * filtering (e.g., /admin/diagnostic/* GET routes, where non-owners see only
 * their own logs via a Prisma WHERE clause that depends on X-User-Id).
 */

import { getConfig, CONTENT_TYPES, TIMEOUTS } from '@tzurot/common-types';
import { getValidatedServiceSecret } from '../startup.js';

/**
 * Options for admin API requests
 */
interface AdminFetchOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  /**
   * Discord user ID for bot owner verification.
   * Required for routes that check isBotOwner() (e.g., /admin/settings).
   */
  userId?: string;
}

/**
 * Make an authenticated request to an admin endpoint
 *
 * Automatically:
 * - Prepends GATEWAY_URL to the path
 * - Adds X-Service-Auth header for service authentication
 * - Merges any additional headers
 *
 * @param path - API path (e.g., '/admin/usage')
 * @param options - Fetch options (method, body, headers, etc.)
 * @returns Fetch response
 *
 * @example
 * ```ts
 * // GET request
 * const response = await adminFetch('/admin/usage?timeframe=7d');
 *
 * // POST request with JSON body
 * const response = await adminFetch('/admin/db-sync', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ dryRun: true }),
 * });
 * ```
 */
export async function adminFetch(path: string, options: AdminFetchOptions = {}): Promise<Response> {
  const config = getConfig();
  const gatewayUrl = config.GATEWAY_URL;

  if (gatewayUrl === undefined || gatewayUrl.length === 0) {
    throw new Error('GATEWAY_URL is not configured');
  }

  const { headers: customHeaders, userId, signal: callerSignal, ...restOptions } = options;

  // Build headers with service auth and optional user ID
  const headers: Record<string, string> = {
    ...customHeaders,
    'X-Service-Auth': getValidatedServiceSecret(),
  };

  // Add user ID header if provided (required for isBotOwner checks)
  if (userId !== undefined) {
    headers['X-User-Id'] = userId;
  }

  // Bound the request so a hung api-gateway doesn't leave the slash command
  // sitting in "Thinking…" until Discord's 15-min interaction expiry fires.
  // Caller-supplied signal is composed via `AbortSignal.any` so either
  // intentional cancellation OR our timeout aborts the fetch.
  const timeoutSignal = AbortSignal.timeout(TIMEOUTS.ADMIN_GATEWAY);
  const signal =
    callerSignal !== undefined && callerSignal !== null
      ? AbortSignal.any([callerSignal, timeoutSignal])
      : timeoutSignal;

  return fetch(`${gatewayUrl}${path}`, {
    ...restOptions,
    headers,
    signal,
  });
}

/**
 * Make an authenticated JSON POST request to an admin endpoint
 *
 * Convenience wrapper that:
 * - Sets Content-Type to application/json
 * - Stringifies the body
 * - Adds admin authentication
 *
 * @param path - API path (e.g., '/admin/db-sync')
 * @param body - Object to send as JSON body
 * @param userId - Optional Discord user ID for bot owner verification
 * @returns Fetch response
 *
 * @example
 * ```ts
 * const response = await adminPostJson('/admin/db-sync', {
 *   dryRun: true,
 *   ownerId: interaction.user.id,
 * });
 * ```
 */
export async function adminPostJson(
  path: string,
  body: Record<string, unknown>,
  userId?: string
): Promise<Response> {
  return adminFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': CONTENT_TYPES.JSON,
    },
    body: JSON.stringify(body),
    userId,
  });
}

/**
 * Make an authenticated JSON PUT request to an admin endpoint
 *
 * @param path - API path (e.g., '/admin/llm-config/123')
 * @param body - Object to send as JSON body
 * @param userId - Optional Discord user ID for bot owner verification
 * @returns Fetch response
 */
export async function adminPutJson(
  path: string,
  body: Record<string, unknown>,
  userId?: string
): Promise<Response> {
  return adminFetch(path, {
    method: 'PUT',
    headers: {
      'Content-Type': CONTENT_TYPES.JSON,
    },
    body: JSON.stringify(body),
    userId,
  });
}

/**
 * Make an authenticated JSON PATCH request to an admin endpoint
 *
 * @param path - API path (e.g., '/admin/settings')
 * @param body - Object to send as JSON body (partial update)
 * @param userId - Optional Discord user ID for bot owner verification
 * @returns Fetch response
 */
export async function adminPatchJson(
  path: string,
  body: Record<string, unknown>,
  userId?: string
): Promise<Response> {
  return adminFetch(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': CONTENT_TYPES.JSON,
    },
    body: JSON.stringify(body),
    userId,
  });
}
