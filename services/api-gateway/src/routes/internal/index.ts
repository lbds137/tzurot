/**
 * Internal Routes Router
 *
 * Service-to-service endpoints under /internal/. Already protected by the
 * global requireServiceAuth() middleware in api-gateway/src/index.ts; no
 * per-route auth wiring needed.
 */

import { Router } from 'express';
import type { RouteDeps } from '../routeDeps.js';
import { handleRecentUsers } from './usersRecent.js';
import { handleSetDmSession } from './dmSessionSet.js';

export function createInternalRouter(deps: RouteDeps): Router {
  const router = Router();
  router.get('/users/recent', handleRecentUsers(deps));
  router.post('/channel/dm-session/set', handleSetDmSession(deps));
  return router;
}
