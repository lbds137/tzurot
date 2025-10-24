/**
 * Admin Routes
 * Owner-only administrative endpoints
 */

import express, { Request, Response, Router } from 'express';
import { createLogger, getConfig } from '@tzurot/common-types';
import { DatabaseSyncService } from '../services/DatabaseSyncService.js';
import type { ErrorResponse } from '../types.js';

const logger = createLogger('admin-routes');
const router: Router = express.Router();

/**
 * POST /admin/db-sync
 * Bidirectional database synchronization between dev and prod
 */
router.post('/db-sync', async (req: Request, res: Response) => {
  try {
    const { dryRun = false, ownerId } = req.body;
    const config = getConfig();

    // Verify owner authorization
    if (!ownerId || !config.BOT_OWNER_ID || ownerId !== config.BOT_OWNER_ID) {
      const errorResponse: ErrorResponse = {
        error: 'UNAUTHORIZED',
        message: 'This endpoint is only available to the bot owner',
        timestamp: new Date().toISOString()
      };
      res.status(403).json(errorResponse);
      return;
    }

    // Verify database URLs are configured
    if (!config.DEV_DATABASE_URL || !config.PROD_DATABASE_URL) {
      const errorResponse: ErrorResponse = {
        error: 'CONFIGURATION_ERROR',
        message: 'Both DEV_DATABASE_URL and PROD_DATABASE_URL must be configured',
        timestamp: new Date().toISOString()
      };
      res.status(500).json(errorResponse);
      return;
    }

    logger.info({ dryRun }, '[Admin] Starting database sync');

    // Execute sync
    const syncService = new DatabaseSyncService(
      config.DEV_DATABASE_URL,
      config.PROD_DATABASE_URL
    );

    const result = await syncService.sync({ dryRun });

    logger.info({ result }, '[Admin] Database sync complete');

    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error({ err: error }, '[Admin] Database sync failed');

    const errorResponse: ErrorResponse = {
      error: 'SYNC_ERROR',
      message: error instanceof Error ? error.message : 'Database sync failed',
      timestamp: new Date().toISOString()
    };

    res.status(500).json(errorResponse);
  }
});

export { router as adminRouter };
