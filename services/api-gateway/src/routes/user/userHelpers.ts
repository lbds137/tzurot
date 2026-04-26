/**
 * Shared user helpers for all user route modules
 *
 * Reads the `provisionedUserId` + `provisionedDefaultPersonaId` attached
 * by the `requireProvisionedUser` middleware. The middleware enforces
 * both fields are set (returning 400 otherwise) before any handler runs,
 * so this is a safe direct read.
 */

import type { ProvisionedRequest } from '../../types.js';

/**
 * Get the internal user ID and default persona ID for an HTTP-route
 * handler.
 *
 * Returns the fields attached by the `requireProvisionedUser` middleware.
 * Throws if either is missing — defense-in-depth against the middleware
 * being misconfigured on a route. The middleware itself returns 400 if
 * the upstream request is missing the required user-context headers.
 */
export function getOrCreateInternalUser(req: ProvisionedRequest): {
  id: string;
  defaultPersonaId: string;
} {
  const { provisionedUserId, provisionedDefaultPersonaId } = req;
  if (provisionedUserId === undefined || provisionedDefaultPersonaId === undefined) {
    throw new Error(
      'getOrCreateInternalUser called on request without provisioned fields — ' +
        'requireProvisionedUser middleware is missing from the route'
    );
  }
  return {
    id: provisionedUserId,
    defaultPersonaId: provisionedDefaultPersonaId,
  };
}
