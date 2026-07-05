/**
 * POST /admin/db-sync
 * Bidirectional database synchronization between dev and prod
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';
import { getConfig } from '@tzurot/common-types/config/config';
import { DbSyncSchema } from '@tzurot/common-types/schemas/api/admin';
import { transientPoolOptions } from '@tzurot/common-types/services/poolConfig';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { PrismaPg } from '@prisma/adapter-pg';
import { DatabaseSyncService } from '../../services/DatabaseSyncService.js';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('admin-db-sync');

/**
 * POST /api/admin/db-sync — named handler export consumed by the
 * generated mounts.ts codegen. The returned `RequestHandler` is
 * composition-ready; middleware (auth, rate limiters) is applied by
 * the caller — at the prefix mount for codegen-driven routes, or
 * per-route for the legacy factory below.
 */
export const handleDbSync = (_deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = DbSyncSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { dryRun, allowSchemaSkew } = parseResult.data;
    const config = getConfig();

    // Verify database URLs are configured
    if (
      config.DEV_DATABASE_URL === undefined ||
      config.DEV_DATABASE_URL.length === 0 ||
      config.PROD_DATABASE_URL === undefined ||
      config.PROD_DATABASE_URL.length === 0
    ) {
      return sendError(
        res,
        ErrorResponses.configurationError(
          'Both DEV_DATABASE_URL and PROD_DATABASE_URL must be configured'
        )
      );
    }

    logger.info({ dryRun, allowSchemaSkew }, 'Starting database sync');

    // Create Prisma clients for dev and prod databases using driver adapters.
    // transientPoolOptions caps these short-lived cross-env sync pools and gives
    // them a finite acquisition timeout (the adapter ignores connection_limit).
    const devAdapter = new PrismaPg({
      connectionString: config.DEV_DATABASE_URL,
      ...transientPoolOptions(),
    });
    const devClient = new PrismaClient({ adapter: devAdapter });

    const prodAdapter = new PrismaPg({
      connectionString: config.PROD_DATABASE_URL,
      ...transientPoolOptions(),
    });
    const prodClient = new PrismaClient({ adapter: prodAdapter });

    // Execute sync - the service handles connect/disconnect internally
    const syncService = new DatabaseSyncService(devClient, prodClient);
    const result = await syncService.sync({ dryRun, allowSchemaSkew });

    logger.info({ result }, 'Database sync complete');

    sendCustomSuccess(res, {
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  });

/**
 * Legacy factory for the `/admin/db-sync` mount. Wraps the named
 * handler with the per-route middleware for callers that haven't
 * yet migrated to the bare handler export.
 */
export function createDbSyncRoute(deps: RouteDeps): Router {
  const router = Router();
  router.post('/', requireOwnerAuth(), handleDbSync(deps));
  return router;
}
