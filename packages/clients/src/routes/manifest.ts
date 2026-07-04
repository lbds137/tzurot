/**
 * Central route manifest registry.
 *
 * Imports the three audience-scoped registries (internal, admin, user)
 * and exposes a unified `ROUTE_MANIFEST` for tools that need to iterate
 * across audiences — primarily the codegen tool that generates server
 * mounts + typed client classes.
 *
 * The three audience manifests are the source of truth for their own
 * routes; this file is composition only. Adding a route means editing
 * the audience file, not this one.
 *
 * Audience semantics (matched to the URL prefix mounting in
 * services/api-gateway/src/index.ts):
 *
 *   `/api/internal/*`  → service-to-service. No human actor.
 *                        Authenticated via X-Service-Secret only.
 *   `/api/admin/*`     → bot-owner-only. Human actor is the bot owner.
 *                        Authenticated via X-Service-Secret + bot-owner
 *                        check on the resolved user.
 *   `/api/user/*`      → any authenticated Discord user.
 *                        Most routes require user provisioning.
 *
 * Cross-audience invariants (asserted in manifest.test.ts):
 *   - No (audience, method, path) tuple appears in two manifests.
 *   - Route IDs are globally unique across all three audiences.
 *   - acceptsSubject only on admin or user audiences (internal has no
 *     human actor → no subject distinction).
 *   - serviceOnly only on internal audience.
 *   - requiresProvisionedUser only on user audience (internal has no
 *     user, admin actor is verified by ownership check not provisioning).
 */

import { adminRoutes } from './admin.js';
import { internalRoutes } from './internal.js';
import type { RouteDef } from './types.js';
import { userRoutes } from './user/index.js';

/**
 * The canonical route registry. Keys are route IDs (globally unique);
 * values are the full RouteDef declarations from the audience manifests.
 *
 * Iteration order: internal → admin → user. The codegen tool emits
 * generated files in this order to keep diffs stable.
 */
export const ROUTE_MANIFEST = {
  ...internalRoutes,
  ...adminRoutes,
  ...userRoutes,
} as const satisfies Record<string, RouteDef>;
/** Re-export the audience-scoped registries so tooling can iterate by audience. */
export { adminRoutes, internalRoutes, userRoutes };
