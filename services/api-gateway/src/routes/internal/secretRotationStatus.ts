/**
 * GET /api/internal/secret-rotations
 *
 * The per-environment secret-rotation ledger with overdue state computed
 * server-side (single source of interval math). Service-auth protected like
 * every internal route. Consumed by bot-client's daily rotation-nag
 * scheduler, which posts an owner-channel embed when anything is overdue.
 *
 * Ledger rows are written only by the `pnpm ops secrets:*` commands
 * (mark-rotated / rotate-byok) — this route is read-only.
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { SecretRotationStatusResponseSchema } from '@tzurot/common-types/schemas/api/internal';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Bounded read: the ledger is one row per secret — far below this cap. */
const MAX_ENTRIES = 100;

/** GET /api/internal/secret-rotations — ledger + computed overdue. */
export const handleSecretRotationStatus = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (_req: Request, res: Response) => {
    const rows = await prisma.secretRotation.findMany({
      orderBy: { name: 'asc' },
      take: MAX_ENTRIES,
    });

    const now = Date.now();
    const entries = rows.map(row => {
      const dueAt = row.rotatedAt.getTime() + row.intervalDays * MS_PER_DAY;
      const overdueDays = Math.max(0, Math.floor((now - dueAt) / MS_PER_DAY));
      return {
        name: row.name,
        rotatedAt: row.rotatedAt.toISOString(),
        intervalDays: row.intervalDays,
        overdueDays,
      };
    });

    const parsed = SecretRotationStatusResponseSchema.parse({
      entries,
      overdueCount: entries.filter(entry => entry.overdueDays > 0).length,
    });

    sendCustomSuccess(res, parsed, StatusCodes.OK);
  });
};
