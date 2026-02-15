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
  createLogger,
  type ConfigCascadeCacheInvalidationService,
} from '@tzurot/common-types';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { mergeConfigOverrides } from '../../utils/configOverrideMerge.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { isAuthorizedForRead, isAuthorizedForWrite } from '../../services/AuthMiddleware.js';

const logger = createLogger('admin-settings-routes');

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

export function createAdminSettingsRoutes(
  prisma: PrismaClient,
  cascadeInvalidation?: ConfigCascadeCacheInvalidationService
): Router {
  const router = Router();

  /** Build response object from DB settings */
  function buildResponse(settings: Prisma.AdminSettingsGetPayload<object>): {
    id: string;
    updatedBy: string | null;
    configDefaults: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      id: settings.id,
      updatedBy: settings.updatedBy,
      configDefaults: settings.configDefaults as Record<string, unknown> | null,
      createdAt: settings.createdAt.toISOString(),
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

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
      const response = buildResponse(settings);
      AdminSettingsSchema.parse(response);
      sendCustomSuccess(res, response, StatusCodes.OK);
    })
  );

  /**
   * PATCH /admin/settings
   * Update AdminSettings fields (merge semantics for configDefaults)
   *
   * Body: { configDefaults?: Partial<ConfigOverrides> }
   * Merges partial configDefaults into existing JSONB. Send null to clear.
   */
  router.patch(
    '/',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!isAuthorizedForWrite(req.userId)) {
        sendError(res, ErrorResponses.unauthorized('Only bot owners can update settings'));
        return;
      }

      const { configDefaults } = req.body as { configDefaults?: Record<string, unknown> | null };

      // Resolve Discord ID → User UUID for the updatedBy FK
      const user = await prisma.user.findFirst({
        where: { discordId: req.userId },
        select: { id: true },
      });

      // Build update data (use unchecked input to set updatedBy scalar directly)
      const updateData: Prisma.AdminSettingsUncheckedUpdateInput = {
        updatedBy: user?.id ?? null,
      };

      if (configDefaults !== undefined) {
        if (configDefaults === null) {
          updateData.configDefaults = Prisma.JsonNull;
        } else {
          const existing = await getOrCreateSettings(prisma);
          const configDefaultsValue = mergeConfigOverrides(existing.configDefaults, configDefaults);
          if (configDefaultsValue === 'invalid') {
            sendError(res, ErrorResponses.validationError('Invalid configDefaults format'));
            return;
          }
          updateData.configDefaults =
            configDefaultsValue === null
              ? Prisma.JsonNull
              : (configDefaultsValue as Prisma.InputJsonValue);
        }
      }

      const updated = await prisma.adminSettings.update({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        data: updateData,
      });

      // Invalidate cascade cache (admin tier affects everyone)
      if (cascadeInvalidation !== undefined) {
        try {
          await cascadeInvalidation.invalidateAdmin();
        } catch (error) {
          logger.warn(
            { err: error },
            '[AdminSettings] Failed to publish cascade cache invalidation'
          );
        }
      }

      const response = buildResponse(updated);
      AdminSettingsSchema.parse(response);
      sendCustomSuccess(res, response, StatusCodes.OK);
    })
  );

  return router;
}
