/**
 * Notifications + feedback retention (daily scheduled job).
 *
 * 90-day handled-only purge — rows leave only once the system is done with
 * them:
 * - user_feedback: only status read/archived. Untriaged rows ('new') are
 *   kept indefinitely — the owner hasn't seen them yet.
 * - release_delivery_log: only settled rows. Standing-DM rows (sent, message
 *   not yet deleted) back /notifications cleanup and the next blast's
 *   delete-previous; pending rows belong to the incomplete-broadcast sweep.
 *   Purging either class would break a live behavior, so both are exempt.
 * - release_announcements: NEVER purged — the unique version row is the
 *   re-announce idempotency backbone.
 */

import { CLEANUP_DEFAULTS } from '@tzurot/common-types/constants/timing';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('cleanupNotificationsRetention');

const DAY_MS = 24 * 60 * 60 * 1000;

export async function cleanupNotificationsRetention(
  prisma: PrismaClient
): Promise<{ feedbackDeleted: number; deliveriesDeleted: number }> {
  const feedbackCutoff = new Date(
    Date.now() - CLEANUP_DEFAULTS.DAYS_TO_KEEP_HANDLED_FEEDBACK * DAY_MS
  );
  const deliveriesCutoff = new Date(
    Date.now() - CLEANUP_DEFAULTS.DAYS_TO_KEEP_SETTLED_DELIVERIES * DAY_MS
  );

  const feedback = await prisma.userFeedback.deleteMany({
    where: {
      status: { in: ['read', 'archived'] },
      createdAt: { lt: feedbackCutoff },
    },
  });

  const deliveries = await prisma.releaseDeliveryLog.deleteMany({
    where: {
      createdAt: { lt: deliveriesCutoff },
      // Settled only: pending rows are the incomplete-broadcast sweep's to
      // resolve, and a sent-but-undeleted row is the user's standing DM.
      status: { not: 'pending' },
      NOT: { sentMessageId: { not: null }, messageDeletedAt: null },
    },
  });

  if (feedback.count > 0 || deliveries.count > 0) {
    logger.info(
      { feedbackDeleted: feedback.count, deliveriesDeleted: deliveries.count },
      'Purged aged notification/feedback rows'
    );
  }

  return { feedbackDeleted: feedback.count, deliveriesDeleted: deliveries.count };
}
