/**
 * Recent-days digest: usage_logs bookkeeping.
 *
 * Written via the ordinary Prisma client — `usage_logs` is not sync-tracked,
 * so there is no `updated_at`-clobber hazard to guard against. One row per
 * billed model call: a regeneration bills a second row, mirroring the
 * archive summarizer's `archiveSummaryUsageLog.ts`.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateUsageLogUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { RECENT_DAYS_DIGEST_REQUEST_TYPE } from '@tzurot/common-types/constants/recentDaysDigest';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { SystemModelResult } from '../systemModel/systemModelCall.js';

const logger = createLogger('RecentDaysDigestUsageLog');

/** One usage_logs row per model call, fail-soft — a bookkeeping failure must
 *  never cost a digest generation. */
export async function writeRecentDaysDigestUsageLog(
  prisma: PrismaClient,
  usage: SystemModelResult,
  row: { personalityId: string; ownerId: string },
  latencyMs: number
): Promise<void> {
  try {
    const createdAt = new Date();
    await prisma.usageLog.create({
      data: {
        id: generateUsageLogUuid(row.ownerId, usage.model, createdAt),
        userId: row.ownerId,
        provider: usage.provider,
        model: usage.model,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        requestType: RECENT_DAYS_DIGEST_REQUEST_TYPE,
        createdAt,
        personalityId: row.personalityId,
        latencyMs,
      },
    });
  } catch (error) {
    logger.warn(
      { err: error, personalityId: row.personalityId },
      'Recent-days digest usage row failed — continuing'
    );
  }
}
