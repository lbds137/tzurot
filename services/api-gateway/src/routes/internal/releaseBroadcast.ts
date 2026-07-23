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
  type BroadcastCompletionSummary,
} from '@tzurot/common-types/schemas/api/broadcast';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { computeCompletionSummary } from '../../services/releaseBroadcast.js';
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
 * Resweep terminalizations (errorCode 'opted_out') are invisible here: they
 * record an eligibility exclusion, not a delivery event — no send happened,
 * so they neither count toward the closed-DM streak nor break it.
 */
async function maybeAutoDisable(
  prisma: PrismaClient,
  deliveryLogId: string,
  userId: string
): Promise<boolean> {
  const previous = await prisma.releaseDeliveryLog.findFirst({
    where: {
      userId,
      id: { not: deliveryLogId },
      status: { not: 'pending' },
      NOT: { errorCode: 'opted_out' },
    },
    orderBy: { updatedAt: 'desc' },
    select: { status: true },
  });
  if (previous?.status !== 'failed_permanent') {
    return false;
  }
  // notifyAutoDisabledAt marks this as an INFRASTRUCTURE disable (unreachable),
  // distinct from a user-chosen opt-out — the next deliberate use lifts it
  // (liftNotifyAutoDisable), which must never happen to an explicit opt-out.
  await prisma.user.update({
    where: { id: userId },
    data: { notifyEnabled: false, notifyAutoDisabledAt: new Date() },
  });
  return true;
}

/**
 * Handle a freshly-transitioned permanent-failure row: start the retention
 * undeliverable clock (per-user unreachable codes only) and escalate to
 * auto-disable on a second consecutive failure. Returns the userId IFF this
 * call auto-disabled them (so the caller can report it), else null.
 *
 * Retention: 50278 = user left every shared server; 50007 = DMs closed or bot
 * blocked. NEVER 20026 (bot-wide quarantine — would false-flag every recipient)
 * or 10013 (deleted account — a distinct, stronger signal deferred to the Phase
 * 2 purge branch). The `dm_undeliverable_since IS NULL` guard records the FIRST
 * failure only (never advances a live streak); raw SQL keeps the column off
 * updated_at, the dev<->prod sync LWW resolver — same reasoning as the
 * getOrCreateUser lastActiveAt stamp.
 *
 * Best-effort, never fatal (mirrors the getOrCreateUser stamp's swallow): these
 * are non-critical signals that self-heal on the next release blast (a still-
 * unreachable user fails again and re-stamps). The caller has ALREADY committed
 * this row's terminal transition before calling us, so a thrown error here would
 * both 500 the whole batch (asyncHandler → unrelated later rows never process)
 * AND permanently strand this row — a retry's `status: 'pending'` guard now
 * matches 0, so it skips the row entirely and its stamp/escalation are lost for
 * good. Swallow + log instead; return null (no auto-disable reported).
 */
async function recordPermanentFailure(
  prisma: PrismaClient,
  deliveryLogId: string,
  errorCode: string | undefined
): Promise<string | null> {
  try {
    const row = await prisma.releaseDeliveryLog.findUnique({
      where: { id: deliveryLogId },
      select: { userId: true },
    });
    if (row === null) {
      return null;
    }
    if (errorCode === '50278' || errorCode === '50007') {
      await prisma.$executeRaw`
        UPDATE users SET dm_undeliverable_since = NOW()
        WHERE id = ${row.userId}::uuid AND dm_undeliverable_since IS NULL
      `;
    }
    return (await maybeAutoDisable(prisma, deliveryLogId, row.userId)) ? row.userId : null;
  } catch (err) {
    logger.warn(
      { err, deliveryLogId },
      'Permanent-failure side-effects (undeliverable stamp / auto-disable) failed; non-fatal'
    );
    return null;
  }
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
      // The worker deleted this user's PRIOR release DM before sending —
      // stamp that ledger row so no cleanup path retries a gone message.
      // This runs BEFORE the pending-only continue below: the deletion claim
      // is independent of the main row's transition state, and a lost-response
      // retry (same payload, main row already terminal) must still land the
      // stamp — the two writes are not atomic. Idempotent via the null guard.
      if (result.deletedPreviousDeliveryLogId !== undefined) {
        await prisma.releaseDeliveryLog.updateMany({
          where: { id: result.deletedPreviousDeliveryLogId, messageDeletedAt: null },
          data: { messageDeletedAt: now },
        });
      }

      const transition = await prisma.releaseDeliveryLog.updateMany({
        // pending-only guard = idempotency: a re-reported row no-ops.
        where: { id: result.deliveryLogId, releaseId, status: 'pending' },
        data: {
          status: result.status,
          errorCode: result.errorCode ?? null,
          attemptedAt: now,
          sentMessageId: result.sentMessageId ?? null,
        },
      });
      if (transition.count === 0) {
        continue;
      }
      updated += 1;

      if (result.status === 'failed_permanent') {
        const autoDisabledUserId = await recordPermanentFailure(
          prisma,
          result.deliveryLogId,
          result.errorCode
        );
        if (autoDisabledUserId !== null) {
          autoDisabledUserIds.push(autoDisabledUserId);
        }
      }
    }

    const summary = await stampCompletionIfFinal(prisma, releaseId, now);
    const completed = summary !== undefined;

    logger.info(
      { releaseId, reported: parseResult.data.results.length, updated, completed },
      'Delivery outcomes recorded'
    );

    sendContractSuccess(res, ReleaseBroadcastDeliveriesResponseSchema, {
      updated,
      autoDisabledUserIds,
      completed,
      ...(summary !== undefined ? { summary } : {}),
    });
  });
};

/**
 * Stamp completedAt when the release has no pending rows left, returning the
 * final tally IFF this call performed the flip. Completion derives from the
 * FLIP, not from "no pending rows": a lost-response re-report (or a
 * concurrent reporter) also sees zero pending, and telling both "completed"
 * would double-post the downstream ops report — the null-guarded updateMany
 * hands exactly one caller the summary.
 */
async function stampCompletionIfFinal(
  prisma: PrismaClient,
  releaseId: string,
  now: Date
): Promise<BroadcastCompletionSummary | undefined> {
  const pendingLeft = await prisma.releaseDeliveryLog.count({
    where: { releaseId, status: 'pending' },
  });
  if (pendingLeft > 0) {
    return undefined;
  }
  const flip = await prisma.releaseAnnouncement.updateMany({
    where: { id: releaseId, completedAt: null },
    data: { completedAt: now },
  });
  if (flip.count !== 1) {
    return undefined;
  }
  const summary = await computeCompletionSummary(prisma, releaseId);
  // The Discord ops post downstream is at-most-once (a lost winning response
  // drops it) — this log line is the durable record.
  logger.info({ releaseId, ...summary }, 'Broadcast completed');
  return summary;
}
