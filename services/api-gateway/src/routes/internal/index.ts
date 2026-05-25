/**
 * Internal Routes Router
 *
 * Service-to-service endpoints under /internal/. Already protected by the
 * global requireServiceAuth() middleware in api-gateway/src/index.ts; no
 * per-route auth wiring needed.
 */

import { Router } from 'express';
import type { RouteDeps } from '../routeDeps.js';
import { createUsersRecentHandler } from './usersRecent.js';
import { createDmSessionSetHandler } from './dmSessionSet.js';

export function createInternalRouter(deps: RouteDeps): Router {
  const router = Router();
  const { prisma } = deps;
  router.get('/users/recent', createUsersRecentHandler(prisma));
  router.post('/channel/dm-session/set', ...createDmSessionSetHandler(prisma));
  return router;
}
