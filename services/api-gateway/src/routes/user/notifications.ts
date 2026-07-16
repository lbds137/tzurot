/**
 * User Notification-Preference Routes
 * GET /user/notifications - Get release-notes DM preferences
 * PATCH /user/notifications - Partially update them (enabled and/or level)
 * GET /user/notifications/release-dms - Standing release DMs (for cleanup)
 * POST /user/notifications/release-dms/deleted - Stamp deleted release DMs
 */

import { type Response, type RequestHandler } from 'express';
import {
  GetNotificationPrefsResponseSchema,
  UpdateNotificationPrefsInputSchema,
  UpdateNotificationPrefsResponseSchema,
  ListReleaseDmsResponseSchema,
  MarkReleaseDmsDeletedInputSchema,
  MarkReleaseDmsDeletedResponseSchema,
  RELEASE_DM_CLEANUP_MAX,
} from '@tzurot/common-types/schemas/api/notifications';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { stampNotifyOptedIn } from '../../services/notifyOptIn.js';
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

    // An explicit prefs update is deliberate use — it must qualify the user
    // for the eligibility gate, or an opted-out user who re-enables (and any
    // passive-row user who opts up) would stay null-gated forever. A failure
    // here deliberately propagates (unlike the best-effort ai-worker/setKey
    // stamps): a silent miss has no self-heal path for a passive user — they
    // believe they opted in but stay ineligible — while a 500 on this
    // idempotent PATCH is safely retried.
    await stampNotifyOptedIn(prisma, userId);

    sendContractSuccess(res, UpdateNotificationPrefsResponseSchema, {
      success: true,
      enabled: updated.notifyEnabled,
      level: updated.notifyLevel,
    });
  });
};

/**
 * GET /api/user/notifications/release-dms — the user's release DMs still
 * standing (sent, not yet confirmed deleted). /notifications cleanup deletes
 * these from the DM channel, then reports back via the deleted route below.
 */
export const handleListReleaseDms = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const userId = resolveProvisionedUserId(req);

    const rows = await prisma.releaseDeliveryLog.findMany({
      where: { userId, sentMessageId: { not: null }, messageDeletedAt: null },
      select: { id: true, sentMessageId: true },
      orderBy: { attemptedAt: 'desc' },
      take: RELEASE_DM_CLEANUP_MAX,
    });

    sendContractSuccess(res, ListReleaseDmsResponseSchema, {
      messages: rows.map(row => ({
        deliveryLogId: row.id,
        // Non-null by the where clause; Prisma's select type can't see that.
        messageId: row.sentMessageId ?? '',
      })),
    });
  });
};

/**
 * POST /api/user/notifications/release-dms/deleted — stamp rows whose DM the
 * bot just deleted (or found already gone). Ownership-scoped: the userId
 * filter means a user can only ever stamp their own rows.
 */
export const handleMarkReleaseDmsDeleted = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const parseResult = MarkReleaseDmsDeletedInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const userId = resolveProvisionedUserId(req);

    const marked = await prisma.releaseDeliveryLog.updateMany({
      where: {
        id: { in: parseResult.data.deliveryLogIds },
        userId,
        messageDeletedAt: null,
      },
      data: { messageDeletedAt: new Date() },
    });

    logger.info({ userId, marked: marked.count }, 'Release DMs marked deleted');

    sendContractSuccess(res, MarkReleaseDmsDeletedResponseSchema, {
      success: true,
      marked: marked.count,
    });
  });
};
