/**
 * Internal release-broadcast delivery ledger:
 * POST /internal/release-broadcast/:releaseId/pending    — worker's stall-rerun guard
 * POST /internal/release-broadcast/:releaseId/deliveries — per-recipient outcome reporting
 *
 * Both are service-auth-only (bot-client's DM worker). The deliveries write is
 * idempotent (pending→terminal transitions only) — re-reporting a row is a
 * no-op, mirroring aiConfirmDelivery's updateMany-guarded state machine.
 */

import { type Request, type RequestHandler, type Response } from 'express';
import {
  ReleaseBroadcastDeliveriesInputSchema,
  ReleaseBroadcastDeliveriesResponseSchema,
  ReleaseBroadcastPendingInputSchema,
  ReleaseBroadcastPendingResponseSchema,
} from '@tzurot/common-types/schemas/api/broadcast';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { getRequiredParam } from '../../utils/requestParams.js';
import { sendContractSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-release-broadcast');

/** POST /api/internal/release-broadcast/:releaseId/pending */
export const handleReleaseBroadcastPending = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    const parseResult = ReleaseBroadcastPendingInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const releaseId = getRequiredParam(req.params.releaseId, 'releaseId');

    const rows = await prisma.releaseDeliveryLog.findMany({
      where: {
        releaseId,
        id: { in: parseResult.data.deliveryLogIds },
        status: 'pending',
      },
      select: { id: true },
      take: parseResult.data.deliveryLogIds.length,
    });

    sendContractSuccess(res, ReleaseBroadcastPendingResponseSchema, {
      pendingDeliveryLogIds: rows.map(row => row.id),
    });
  });
};

/**
 * A permanent failure immediately after another permanent failure means the
 * user's DMs are durably closed — stop notifying them (council design: don't
 * hammer blocked users). Looks at the user's most recent OTHER delivery row.
 */
async function maybeAutoDisable(
  prisma: PrismaClient,
  deliveryLogId: string,
  userId: string
): Promise<boolean> {
  const previous = await prisma.releaseDeliveryLog.findFirst({
    where: { userId, id: { not: deliveryLogId }, status: { not: 'pending' } },
    orderBy: { updatedAt: 'desc' },
    select: { status: true },
  });
  if (previous?.status !== 'failed_permanent') {
    return false;
  }
  await prisma.user.update({ where: { id: userId }, data: { notifyEnabled: false } });
  return true;
}

/** POST /api/internal/release-broadcast/:releaseId/deliveries */
export const handleReleaseBroadcastDeliveries = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    const parseResult = ReleaseBroadcastDeliveriesInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const releaseId = getRequiredParam(req.params.releaseId, 'releaseId');
    const now = new Date();

    let updated = 0;
    const autoDisabledUserIds: string[] = [];

    for (const result of parseResult.data.results) {
      const transition = await prisma.releaseDeliveryLog.updateMany({
        // pending-only guard = idempotency: a re-reported row no-ops.
        where: { id: result.deliveryLogId, releaseId, status: 'pending' },
        data: {
          status: result.status,
          errorCode: result.errorCode ?? null,
          attemptedAt: now,
        },
      });
      if (transition.count === 0) {
        continue;
      }
      updated += 1;

      if (result.status === 'failed_permanent') {
        const row = await prisma.releaseDeliveryLog.findUnique({
          where: { id: result.deliveryLogId },
          select: { userId: true },
        });
        if (row !== null && (await maybeAutoDisable(prisma, result.deliveryLogId, row.userId))) {
          autoDisabledUserIds.push(row.userId);
        }
      }
    }

    const pendingLeft = await prisma.releaseDeliveryLog.count({
      where: { releaseId, status: 'pending' },
    });
    let completed = false;
    if (pendingLeft === 0) {
      // updateMany + completedAt-null guard keeps the stamp idempotent too.
      await prisma.releaseAnnouncement.updateMany({
        where: { id: releaseId, completedAt: null },
        data: { completedAt: now },
      });
      completed = true;
    }

    logger.info(
      { releaseId, reported: parseResult.data.results.length, updated, completed },
      'Delivery outcomes recorded'
    );

    sendContractSuccess(res, ReleaseBroadcastDeliveriesResponseSchema, {
      updated,
      autoDisabledUserIds,
      completed,
    });
  });
};
