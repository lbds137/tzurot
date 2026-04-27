/**
 * Internal Routes Router
 *
 * Service-to-service endpoints under /internal/. Already protected by the
 * global requireServiceAuth() middleware in api-gateway/src/index.ts; no
 * per-route auth wiring needed.
 */

import { Router } from 'express';
import type { PrismaClient } from '@tzurot/common-types';
import { createUsersRecentHandler } from './usersRecent.js';

export function createInternalRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.get('/users/recent', createUsersRecentHandler(prisma));
  return router;
}
