/**
 * Conformance fixtures: user-audience account data-rights routes.
 *
 * Both export routes operate on locally-stored rows (export_jobs + a BullMQ
 * enqueue the harness's queue stub absorbs), so they run for real.
 */

import {
  ACCOUNT_EXPORT_SLUG,
  ACCOUNT_EXPORT_SOURCE,
} from '@tzurot/common-types/types/account-export';
import { generateExportJobUuid } from '@tzurot/common-types/utils/deterministicUuid';
import type { ConformanceEntry } from './types.js';

export const userAccountFixtures: Record<string, ConformanceEntry> = {
  startAccountExport: {
    body: {},
  },

  getAccountExportStatus: {
    seed: async ctx => {
      // Deterministic id: the (userId, slug, service, format) tuple is unique,
      // and the startAccountExport fixture creates the same tuple — upserting
      // the SAME deterministic row keeps the two fixtures order-independent.
      // completedAt sits outside the 24h export cooldown window so this seed
      // can never 409 the startAccountExport fixture regardless of run order.
      const staleCompletedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const id = generateExportJobUuid(
        ctx.actorUserId,
        ACCOUNT_EXPORT_SLUG,
        ACCOUNT_EXPORT_SOURCE,
        'zip'
      );
      await ctx.prisma.exportJob.upsert({
        where: { id },
        update: {
          status: 'completed',
          fileName: 'tzurot-account-export-conf-2026-01-01.zip',
          fileSizeBytes: 42,
          completedAt: staleCompletedAt,
        },
        create: {
          id,
          userId: ctx.actorUserId,
          sourceSlug: ACCOUNT_EXPORT_SLUG,
          sourceService: ACCOUNT_EXPORT_SOURCE,
          status: 'completed',
          format: 'zip',
          fileName: 'tzurot-account-export-conf-2026-01-01.zip',
          fileSizeBytes: 42,
          completedAt: staleCompletedAt,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
    },
  },
};
