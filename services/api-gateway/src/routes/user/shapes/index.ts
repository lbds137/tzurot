/**
 * Shapes.inc Routes
 *
 * Endpoints:
 * - POST   /user/shapes/auth          - Store encrypted session cookie
 * - DELETE /user/shapes/auth          - Remove stored credentials
 * - GET    /user/shapes/auth/status   - Check credential status
 * - POST   /user/shapes/import        - Start import job
 * - GET    /user/shapes/import/jobs   - Import history
 */

import { Router } from 'express';
import type { Queue } from 'bullmq';
import type { PrismaClient } from '@tzurot/common-types';
import { createShapesAuthRoutes } from './auth.js';
import { createShapesImportRoutes } from './import.js';

export function createShapesRoutes(prisma: PrismaClient, queue?: Queue): Router {
  const router = Router();

  router.use('/auth', createShapesAuthRoutes(prisma));

  if (queue !== undefined) {
    router.use('/import', createShapesImportRoutes(prisma, queue));
  }

  return router;
}
