/**
 * Admin Settings Routes
 * Owner-only endpoints for managing the global AdminSettings singleton
 *
 * Endpoints:
 * - GET /admin/settings - Get the AdminSettings singleton (service-only OR owner)
 * - PATCH /admin/settings/config-defaults - Update configDefaults (owner only)
 * - DELETE /admin/settings/config-defaults - Clear all admin config defaults (owner only)
 *
 * Auth shape: PATCH and DELETE use the standard `requireOwnerAuth()` middleware
 * (consistent with the other 12 admin route modules). GET cannot — it must
 * accept service-only calls (no Discord user context) so bot-client can
 * hydrate its admin-settings cache at startup. The GET keeps the inline
 * `isAuthorizedForRead` check, which permits no-userId requests but rejects
 * user-context requests from non-owners (see `GatewayClient.getAdminSettings()`).
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  type GetAdminSettingsResponse,
  AdminSettingsSchema,
  ADMIN_SETTINGS_SINGLETON_ID,
} from '@tzurot/common-types/schemas/api/adminSettings';
import { type PrismaClient, Prisma } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type ConfigCascadeCacheInvalidationService } from '@tzurot/cache-invalidation';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { mergeConfigOverrides } from '../../utils/configOverrideMerge.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { isAuthorizedForRead, requireOwnerAuth } from '../../services/AuthMiddleware.js';
import type { RouteDeps } from '../routeDeps.js';

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
    // eslint-disable-next-line no-restricted-syntax -- Admin audit FK: route is behind requireOwnerAuth/service auth, not requireProvisionedUser; the Discord ID comes from the X-User-Id header and the internal UUID is needed for AdminSettings.updatedBy FK attribution
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
): (req: Request, res: Response) => Promise<void> {
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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

/**
 * GET /api/admin/settings — Get the AdminSettings singleton.
 * Authorization: service-only OR bot owner (special auth shape — see file
 * header). The handler keeps the inline `isAuthorizedForRead` check.
 */
export const handleGetAdminSettings = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!isAuthorizedForRead(req.userId)) {
      sendError(res, ErrorResponses.unauthorized('Only bot owners can view settings'));
      return;
    }

    const settings = await getOrCreateSettings(prisma);
    const response = buildResponse(settings);
    AdminSettingsSchema.parse(response);
    sendCustomSuccess(res, response, StatusCodes.OK);
  });
};

/** PATCH /api/admin/settings/config-defaults — flat-body partial update */
export const handleUpdateAdminSettings = (deps: RouteDeps): RequestHandler => {
  return createConfigDefaultsPatchHandler(deps.prisma, deps.cascadeInvalidation);
};

/** DELETE /api/admin/settings/config-defaults — clear all admin config defaults */
export const handleClearAdminSettings = (deps: RouteDeps): RequestHandler => {
  const { prisma, cascadeInvalidation } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
  });
};

export function createAdminSettingsRoutes(deps: RouteDeps): Router {
  const router = Router();
  router.get('/', handleGetAdminSettings(deps));
  router.patch('/config-defaults', requireOwnerAuth(), handleUpdateAdminSettings(deps));
  router.delete('/config-defaults', requireOwnerAuth(), handleClearAdminSettings(deps));
  return router;
}
