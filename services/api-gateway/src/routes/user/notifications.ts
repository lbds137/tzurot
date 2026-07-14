/**
 * User Notification-Preference Routes
 * GET /user/notifications - Get release-notes DM preferences
 * PATCH /user/notifications - Partially update them (enabled and/or level)
 */

import { type Response, type RequestHandler } from 'express';
import {
  GetNotificationPrefsResponseSchema,
  UpdateNotificationPrefsInputSchema,
  UpdateNotificationPrefsResponseSchema,
} from '@tzurot/common-types/schemas/api/notifications';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendContractSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('user-notifications');

/** GET /api/user/notifications — fetch the user's release-notes DM prefs */
export const handleGetNotificationPrefs = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const userId = resolveProvisionedUserId(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notifyEnabled: true, notifyLevel: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.notFound('User'));
    }

    sendContractSuccess(res, GetNotificationPrefsResponseSchema, {
      enabled: user.notifyEnabled,
      level: user.notifyLevel,
    });
  });
};

/** PATCH /api/user/notifications — partial update of enabled and/or level */
export const handleUpdateNotificationPrefs = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const parseResult = UpdateNotificationPrefsInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { enabled, level } = parseResult.data;
    const userId = resolveProvisionedUserId(req);

    logger.info({ userId, enabled, level }, 'Updating notification preferences');

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(enabled !== undefined ? { notifyEnabled: enabled } : {}),
        ...(level !== undefined ? { notifyLevel: level } : {}),
      },
      select: { notifyEnabled: true, notifyLevel: true },
    });

    sendContractSuccess(res, UpdateNotificationPrefsResponseSchema, {
      success: true,
      enabled: updated.notifyEnabled,
      level: updated.notifyLevel,
    });
  });
};
