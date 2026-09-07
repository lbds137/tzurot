/**
 * Memory-archive summarizer: usage_logs bookkeeping.
 *
 * Split out of `ArchiveSummaryProcessor.ts` to keep that module under the
 * `max-lines` limit. Unlike `archiveSummaryStore.ts` (raw SQL against
 * `memories`, a sync-tracked table), this writes `usage_logs` via the
 * ordinary Prisma client — that table is not sync-tracked, so there is no
 * `updated_at`-clobber hazard to guard against.
 *
 * Mirrors `FactExtractionService.logExtractionUsage` apart from two things:
 * the attributed owner id arrives on the already-joined row rather than from
 * a per-call `persona.findUnique`, and each row carries the `latencyMs` of
 * its individual model call.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateUsageLogUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { SystemModelResult } from '../systemModel/systemModelCall.js';

const logger = createLogger('ArchiveSummaryUsageLog');

/** @spec MEM-ARCH-023
 * One usage_logs row per model call, fail-soft — a bookkeeping failure must
 * never cost a summarization. */
export async function writeArchiveSummaryUsageLog(
  prisma: PrismaClient,
  usage: SystemModelResult,
  row: { personalityId: string; ownerId: string | null },
  latencyMs: number
): Promise<void> {
  try {
    if (row.ownerId === null) {
      logger.warn(
        { personalityId: row.personalityId },
        'Archive-summary usage row skipped — no persona on the row'
      );
      return;
    }
    const createdAt = new Date();
    await prisma.usageLog.create({
      data: {
        id: generateUsageLogUuid(row.ownerId, usage.model, createdAt),
        userId: row.ownerId,
        provider: usage.provider,
        model: usage.model,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        requestType: 'archive_summary',
        createdAt,
        personalityId: row.personalityId,
        latencyMs,
      },
    });
  } catch (error) {
    logger.warn(
      { err: error, personalityId: row.personalityId },
      'Archive-summary usage row failed — continuing'
    );
  }
}
