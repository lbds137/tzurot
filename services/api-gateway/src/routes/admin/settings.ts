/**
 * Admin Bot Settings Routes
 * Owner-only endpoints for managing bot-wide settings
 *
 * Endpoints:
 * - GET /admin/settings - List all bot settings
 * - GET /admin/settings/:key - Get a specific setting
 * - PUT /admin/settings/:key - Update or create a setting
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  isBotOwner,
  type PrismaClient,
  UpdateBotSettingRequestSchema,
  ListBotSettingsResponseSchema,
  GetBotSettingResponseSchema,
  UpdateBotSettingResponseSchema,
} from '@tzurot/common-types';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('admin-settings');

interface AuthenticatedRequest extends Request {
  userId: string;
}

export function createAdminSettingsRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /admin/settings
   * List all bot settings
   */
  router.get(
    '/',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      // Only bot owners can access settings
      if (!isBotOwner(req.userId)) {
        sendError(res, ErrorResponses.unauthorized('Only bot owners can view settings'));
        return;
      }

      const settings = await prisma.botSettings.findMany({
        orderBy: { key: 'asc' },
      });

      const response = {
        settings: settings.map(s => ({
          id: s.id,
          key: s.key,
          value: s.value,
          description: s.description,
          updatedBy: s.updatedBy,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
      };

      ListBotSettingsResponseSchema.parse(response);
      sendCustomSuccess(res, response, StatusCodes.OK);
    })
  );

  /**
   * GET /admin/settings/:key
   * Get a specific bot setting
   */
  router.get(
    '/:key',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      // Only bot owners can access settings
      if (!isBotOwner(req.userId)) {
        sendError(res, ErrorResponses.unauthorized('Only bot owners can view settings'));
        return;
      }

      const { key } = req.params;

      const setting = await prisma.botSettings.findUnique({
        where: { key },
      });

      if (setting === null) {
        const response = { found: false };
        GetBotSettingResponseSchema.parse(response);
        sendCustomSuccess(res, response, StatusCodes.OK);
        return;
      }

      const response = {
        found: true,
        setting: {
          id: setting.id,
          key: setting.key,
          value: setting.value,
          description: setting.description,
          updatedBy: setting.updatedBy,
          createdAt: setting.createdAt.toISOString(),
          updatedAt: setting.updatedAt.toISOString(),
        },
      };

      GetBotSettingResponseSchema.parse(response);
      sendCustomSuccess(res, response, StatusCodes.OK);
    })
  );

  /**
   * PUT /admin/settings/:key
   * Update or create a bot setting
   */
  router.put(
    '/:key',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      // Only bot owners can modify settings
      if (!isBotOwner(req.userId)) {
        sendError(res, ErrorResponses.unauthorized('Only bot owners can modify settings'));
        return;
      }

      const { key } = req.params;

      // Validate request body
      const parseResult = UpdateBotSettingRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendError(res, ErrorResponses.validationError(parseResult.error.message));
        return;
      }

      const { value, description } = parseResult.data;

      // Get the user's internal UUID
      const user = await prisma.user.findFirst({
        where: { discordId: req.userId },
        select: { id: true },
      });

      if (user === null) {
        sendError(res, ErrorResponses.notFound('User not found'));
        return;
      }

      // Check if setting exists
      const existing = await prisma.botSettings.findUnique({
        where: { key },
      });

      const created = existing === null;

      // Upsert the setting
      const setting = await prisma.botSettings.upsert({
        where: { key },
        update: {
          value,
          description: description ?? existing?.description,
          updatedBy: user.id,
        },
        create: {
          key,
          value,
          description: description ?? null,
          updatedBy: user.id,
        },
      });

      logger.info({ key, value, updatedBy: req.userId, created }, 'Bot setting updated');

      const response = {
        setting: {
          id: setting.id,
          key: setting.key,
          value: setting.value,
          description: setting.description,
          updatedBy: setting.updatedBy,
          createdAt: setting.createdAt.toISOString(),
          updatedAt: setting.updatedAt.toISOString(),
        },
        created,
      };

      UpdateBotSettingResponseSchema.parse(response);
      sendCustomSuccess(res, response, created ? StatusCodes.CREATED : StatusCodes.OK);
    })
  );

  return router;
}
