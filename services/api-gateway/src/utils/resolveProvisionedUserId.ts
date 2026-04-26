/**
 * Reads the internal user UUID attached to the request by the
 * `requireProvisionedUser` middleware. The middleware enforces that
 * `provisionedUserId` is always set before any handler runs (returning 400
 * on missing user-context headers), so this is a safe direct read.
 *
 * Kept as a named function rather than `req.provisionedUserId` access at
 * each call site so that any future change to the resolution path (cache,
 * fallback, alternate header source) only needs to update one place.
 */

import type { ProvisionedRequest } from '../types.js';

export function resolveProvisionedUserId(req: ProvisionedRequest): string {
  if (req.provisionedUserId === undefined) {
    // Defense-in-depth: should be impossible if requireProvisionedUser middleware
    // is mounted on the route. Throwing here surfaces middleware-misconfiguration
    // bugs at the first request rather than producing silent data corruption.
    throw new Error(
      'resolveProvisionedUserId called on request without provisionedUserId — ' +
        'requireProvisionedUser middleware is missing from the route'
    );
  }
  return req.provisionedUserId;
}
