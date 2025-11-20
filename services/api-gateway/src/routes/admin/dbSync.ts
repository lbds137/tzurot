/**
 * POST /admin/db-sync
 * Bidirectional database synchronization between dev and prod
 */

import { Router, type Request, type Response } from 'express';
import { createLogger, getConfig } from '@tzurot/common-types';
import { PrismaClient } from '@prisma/client';
import { DatabaseSyncService } from '../../services/DatabaseSyncService.js';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('admin-db-sync');

export function createDbSyncRoute(): Router {
  const router = Router();

  router.post(
    '/',
    requireOwnerAuth(),
    asyncHandler(async (req: Request, res: Response) => {
      const { dryRun = false } = req.body as { dryRun?: boolean };
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

      logger.info({ dryRun }, '[Admin] Starting database sync');

      // Create Prisma clients for dev and prod databases
      const devClient = new PrismaClient({
        datasources: {
          db: { url: config.DEV_DATABASE_URL },
        },
      });

      const prodClient = new PrismaClient({
        datasources: {
          db: { url: config.PROD_DATABASE_URL },
        },
      });

      try {
        // Execute sync
        const syncService = new DatabaseSyncService(devClient, prodClient);
        const result = await syncService.sync({ dryRun });

        logger.info({ result }, '[Admin] Database sync complete');

        sendCustomSuccess(res, {
          success: true,
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, '[Admin] Database sync failed');
        throw error; // Let asyncHandler handle it
      } finally {
        await devClient.$disconnect();
        await prodClient.$disconnect();
      }
    })
  );

  return router;
}
