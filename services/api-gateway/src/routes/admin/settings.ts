/**
 * Admin Settings Routes
 * Owner-only endpoints for managing the global AdminSettings singleton
 *
 * Endpoints:
 * - GET /admin/settings - Get the AdminSettings singleton
 * - PATCH /admin/settings/config-defaults - Update configDefaults directly (flat body)
 * - DELETE /admin/settings/config-defaults - Clear all admin config defaults
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  type PrismaClient,
  type GetAdminSettingsResponse,
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

const CASCADE_INVALIDATION_WARN = '[AdminSettings] Failed to publish cascade cache invalidation';

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

/** Publish cascade invalidation for admin tier, swallowing errors. */
async function tryInvalidateAdmin(
  cascadeInvalidation: ConfigCascadeCacheInvalidationService | undefined
): Promise<void> {
  if (cascadeInvalidation === undefined) {
    return;
  }
  try {
    await cascadeInvalidation.invalidateAdmin();
  } catch (error) {
    logger.warn({ err: error }, CASCADE_INVALIDATION_WARN);
  }
}

/** Build response object from DB settings (type stays in sync via z.infer) */
function buildResponse(settings: Prisma.AdminSettingsGetPayload<object>): GetAdminSettingsResponse {
  return {
    id: settings.id,
    updatedBy: settings.updatedBy,
    configDefaults: settings.configDefaults as Record<string, unknown> | null,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

/** Resolve Discord ID → User UUID for the updatedBy FK */
async function resolveUserUuid(prisma: PrismaClient, discordId: string): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { discordId },
    select: { id: true },
  });
  if (user === null) {
    logger.warn({ discordId }, 'Admin operation by unknown user — updatedBy will be null');
  }
  return user?.id ?? null;
}

/**
 * PATCH /admin/settings/config-defaults handler
 * Accepts flat Partial<ConfigOverrides> body (same shape as all cascade tiers).
 */
function createConfigDefaultsPatchHandler(
  prisma: PrismaClient,
  cascadeInvalidation?: ConfigCascadeCacheInvalidationService
): (req: Request, res: Response) => void {
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!isAuthorizedForWrite(req.userId)) {
      sendError(res, ErrorResponses.unauthorized('Only bot owners can update settings'));
      return;
    }

    const input = req.body as Record<string, unknown>;
    const userUuid = await resolveUserUuid(prisma, req.userId);
    const existing = await getOrCreateSettings(prisma);

    const merged = mergeConfigOverrides(existing.configDefaults, input);
    if (merged === 'invalid') {
      sendError(res, ErrorResponses.validationError('Invalid config format'));
      return;
    }

    const updated = await prisma.adminSettings.update({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      data: {
        configDefaults: merged === null ? Prisma.JsonNull : (merged as Prisma.InputJsonValue),
        updatedBy: userUuid,
      },
    });

    await tryInvalidateAdmin(cascadeInvalidation);

    const response = buildResponse(updated);
    AdminSettingsSchema.parse(response);
    sendCustomSuccess(res, response, StatusCodes.OK);
  });
}

export function createAdminSettingsRoutes(
  prisma: PrismaClient,
  cascadeInvalidation?: ConfigCascadeCacheInvalidationService
): Router {
  const router = Router();

  // GET /admin/settings - Get the AdminSettings singleton
  // Authorization: allows service-only calls, requires bot owner for user requests
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

  // PATCH /admin/settings/config-defaults - Flat body (same shape as all cascade tiers)
  router.patch('/config-defaults', createConfigDefaultsPatchHandler(prisma, cascadeInvalidation));

  // DELETE /admin/settings/config-defaults - Clear all admin config defaults
  router.delete(
    '/config-defaults',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!isAuthorizedForWrite(req.userId)) {
        sendError(res, ErrorResponses.unauthorized('Only bot owners can update settings'));
        return;
      }

      const userUuid = await resolveUserUuid(prisma, req.userId);
      await getOrCreateSettings(prisma); // Ensure singleton exists

      await prisma.adminSettings.update({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        data: {
          configDefaults: Prisma.JsonNull,
          updatedBy: userUuid,
        },
      });

      await tryInvalidateAdmin(cascadeInvalidation);

      sendCustomSuccess(res, { success: true }, StatusCodes.OK);
    })
  );

  return router;
}
