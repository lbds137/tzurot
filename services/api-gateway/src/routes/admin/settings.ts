/**
 * Admin Settings Routes
 * Owner-only endpoints for managing the global AdminSettings singleton
 *
 * Endpoints:
 * - GET /admin/settings - Get the AdminSettings singleton
 * - PATCH /admin/settings - Update AdminSettings fields
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  type PrismaClient,
  Prisma,
  AdminSettingsSchema,
  ADMIN_SETTINGS_SINGLETON_ID,
} from '@tzurot/common-types';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { isAuthorizedForRead } from '../../services/AuthMiddleware.js';

interface AuthenticatedRequest extends Request {
  userId: string;
}

/**
 * Get or create the AdminSettings singleton.
 * Uses upsert to ensure the singleton always exists.
 */
async function getOrCreateSettings(
  prisma: PrismaClient
): Promise<Prisma.AdminSettingsGetPayload<object>> {
  return prisma.adminSettings.upsert({
    where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    create: {
      id: ADMIN_SETTINGS_SINGLETON_ID,
      // All other fields use Prisma defaults
    },
    update: {}, // No-op if exists
  });
}

export function createAdminSettingsRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /admin/settings
   * Get the AdminSettings singleton
   *
   * Authorization: Uses isAuthorizedForRead() - allows service-only calls
   * (bot reading extended context defaults), requires bot owner for user requests.
   */
  router.get(
    '/',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!isAuthorizedForRead(req.userId)) {
        sendError(res, ErrorResponses.unauthorized('Only bot owners can view settings'));
        return;
      }

      const settings = await getOrCreateSettings(prisma);

      const response = {
        id: settings.id,
        updatedBy: settings.updatedBy,
        createdAt: settings.createdAt.toISOString(),
        updatedAt: settings.updatedAt.toISOString(),
      };

      AdminSettingsSchema.parse(response);
      sendCustomSuccess(res, response, StatusCodes.OK);
    })
  );

  return router;
}
