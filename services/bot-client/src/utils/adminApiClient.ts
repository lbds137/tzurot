/**
 * Admin API Client
 *
 * Centralized utility for making authenticated requests to admin endpoints.
 * Automatically includes the X-Service-Auth header for service-to-service authentication.
 */

import { getConfig, CONTENT_TYPES } from '@tzurot/common-types';

/**
 * Options for admin API requests
 */
export interface AdminFetchOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
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

  const { headers: customHeaders, ...restOptions } = options;

  return fetch(`${gatewayUrl}${path}`, {
    ...restOptions,
    headers: {
      ...customHeaders,
      'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
    },
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
  body: Record<string, unknown>
): Promise<Response> {
  return adminFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': CONTENT_TYPES.JSON,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Make an authenticated JSON PUT request to an admin endpoint
 *
 * @param path - API path (e.g., '/admin/llm-config/123')
 * @param body - Object to send as JSON body
 * @returns Fetch response
 */
export async function adminPutJson(path: string, body: Record<string, unknown>): Promise<Response> {
  return adminFetch(path, {
    method: 'PUT',
    headers: {
      'Content-Type': CONTENT_TYPES.JSON,
    },
    body: JSON.stringify(body),
  });
}
