/**
 * Admin Settings Routes
 * Owner-only endpoints for managing the global AdminSettings singleton
 *
 * Endpoints:
 * - GET /admin/settings - Get the AdminSettings singleton
 * - PATCH /admin/settings - Update AdminSettings fields
 *
 * This replaces the legacy key-value BotSettings pattern with
 * a structured singleton model with typed columns.
 *
 * @see docs/planning/EXTENDED_CONTEXT_IMPROVEMENTS.md
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  Prisma,
  GetAdminSettingsResponseSchema,
  UpdateAdminSettingsRequestSchema,
  UpdateAdminSettingsResponseSchema,
  ADMIN_SETTINGS_SINGLETON_ID,
} from '@tzurot/common-types';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { isAuthorizedForRead, isAuthorizedForWrite } from '../../services/AuthMiddleware.js';

const logger = createLogger('admin-settings');

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
        extendedContextDefault: settings.extendedContextDefault,
        extendedContextMaxMessages: settings.extendedContextMaxMessages,
        extendedContextMaxAge: settings.extendedContextMaxAge,
        extendedContextMaxImages: settings.extendedContextMaxImages,
      };

      GetAdminSettingsResponseSchema.parse(response);
      sendCustomSuccess(res, response, StatusCodes.OK);
    })
  );

  /**
   * PATCH /admin/settings
   * Update AdminSettings fields
   *
   * Authorization: Uses isAuthorizedForWrite() - always requires bot owner.
   */
  router.patch(
    '/',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!isAuthorizedForWrite(req.userId)) {
        sendError(res, ErrorResponses.unauthorized('Only bot owners can modify settings'));
        return;
      }

      // Validate request body
      const parseResult = UpdateAdminSettingsRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendError(res, ErrorResponses.validationError(parseResult.error.message));
        return;
      }

      const updates = parseResult.data;

      // Check if any fields are being updated
      if (Object.keys(updates).length === 0) {
        sendError(res, ErrorResponses.validationError('No fields to update'));
        return;
      }

      // Get the user's internal UUID
      const user = await prisma.user.findFirst({
        where: { discordId: req.userId },
        select: { id: true },
      });

      if (user === null) {
        sendError(res, ErrorResponses.notFound('User not found'));
        return;
      }

      // Update the singleton (upsert to ensure it exists)
      const settings = await prisma.adminSettings.upsert({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        create: {
          id: ADMIN_SETTINGS_SINGLETON_ID,
          updatedBy: user.id,
          ...updates,
        },
        update: {
          updatedBy: user.id,
          ...updates,
        },
      });

      logger.info({ updates, updatedBy: req.userId }, 'AdminSettings updated');

      const response = {
        id: settings.id,
        updatedBy: settings.updatedBy,
        createdAt: settings.createdAt.toISOString(),
        updatedAt: settings.updatedAt.toISOString(),
        extendedContextDefault: settings.extendedContextDefault,
        extendedContextMaxMessages: settings.extendedContextMaxMessages,
        extendedContextMaxAge: settings.extendedContextMaxAge,
        extendedContextMaxImages: settings.extendedContextMaxImages,
      };

      UpdateAdminSettingsResponseSchema.parse(response);
      sendCustomSuccess(res, response, StatusCodes.OK);
    })
  );

  return router;
}
