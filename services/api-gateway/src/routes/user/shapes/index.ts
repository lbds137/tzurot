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
 * - POST   /user/shapes/export        - Start async export job
 * - GET    /user/shapes/export/jobs   - Export history
 */

import { Router } from 'express';
import { createLogger } from '@tzurot/common-types';
import type { RouteDeps } from '../../routeDeps.js';
import { createShapesAuthRoutes } from './auth.js';
import { createShapesListRoutes } from './list.js';
import { createShapesImportRoutes } from './import.js';
import { createShapesExportRoutes } from './export.js';

const logger = createLogger('shapes-routes');

export function createShapesRoutes(deps: RouteDeps): Router {
  const router = Router();
  const { prisma, aiQueue } = deps;

  router.use('/auth', createShapesAuthRoutes(prisma));
  router.use('/list', createShapesListRoutes(prisma));

  if (aiQueue !== undefined) {
    router.use('/import', createShapesImportRoutes(prisma, aiQueue));
    router.use('/export', createShapesExportRoutes(prisma, aiQueue));
  } else {
    logger.warn('BullMQ queue unavailable — /import and /export routes disabled');
  }

  return router;
}
