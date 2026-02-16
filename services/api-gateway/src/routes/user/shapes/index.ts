/**
 * Shapes.inc Routes
 *
 * Endpoints:
 * - POST   /user/shapes/auth          - Store encrypted session cookie
 * - DELETE /user/shapes/auth          - Remove stored credentials
 * - GET    /user/shapes/auth/status   - Check credential status
 * - GET    /user/shapes/list          - Fetch owned shapes from shapes.inc
 * - POST   /user/shapes/import        - Start import job
 * - GET    /user/shapes/import/jobs   - Import history
 * - POST   /user/shapes/export        - Fetch full character data as JSON
 */

import { Router } from 'express';
import type { Queue } from 'bullmq';
import type { PrismaClient } from '@tzurot/common-types';
import { createShapesAuthRoutes } from './auth.js';
import { createShapesListRoutes } from './list.js';
import { createShapesImportRoutes } from './import.js';
import { createShapesExportRoutes } from './export.js';

export function createShapesRoutes(prisma: PrismaClient, queue?: Queue): Router {
  const router = Router();

  router.use('/auth', createShapesAuthRoutes(prisma));
  router.use('/list', createShapesListRoutes(prisma));
  router.use('/export', createShapesExportRoutes(prisma));

  if (queue !== undefined) {
    router.use('/import', createShapesImportRoutes(prisma, queue));
  }

  return router;
}
