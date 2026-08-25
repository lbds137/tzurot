/**
 * POST /api/internal/export-smoke/start
 * GET  /api/internal/export-smoke/status
 *
 * Weekly export-path smoke: drives the real account-export job pipeline
 * (assembler → ZIP → download) against the system-reserved Orphaned-
 * Characters sentinel account (`ORPHAN_SENTINEL_DISCORD_ID`), never a real
 * user. `start` snapshots expected row counts from the source DB — the
 * caller asserts the finished artifact's manifest against them via
 * `@tzurot/common-types/schemas/export/accountExportManifest`. `status`
 * polls the resulting `export_jobs` row by id.
 *
 * **Authentication**: `X-Service-Auth` is enforced upstream by the global
 * `app.use(requireServiceAuth())` in `services/api-gateway/src/index.ts`,
 * which gates every `/internal/*` route. Requests without a valid service
 * secret never reach either handler here.
 *
 * **The deliberate cooldown bypass**: the user route
 * (`services/api-gateway/src/routes/user/account/export.ts`) enforces a
 * 24-hour cooldown (`EXPORT_COOLDOWN_HOURS`) on completed jobs, so a real
 * user can't re-trigger the most expensive read path in the system on
 * every page reload. This route deliberately does NOT apply that cooldown,
 * because the smoke runs on its own weekly cadence against a system-
 * reserved sentinel account that is not a user-facing account — there is no
 * quota to protect. The bypass is scoped to this internal route via the
 * `checkCooldown` parameter on the shared `createExportJobOrConflict`; the
 * user route's own cooldown enforcement is untouched. The active-job
 * (pending/in_progress) conflict check is NOT part of the bypass — a smoke
 * that stampedes a running export is a bug, and this route returns the same
 * 409 the user route would.
 */

import { type Response, type RequestHandler } from 'express';
import {
  ExportSmokeStartRequestSchema,
  ExportSmokeStartResponseSchema,
  ExportSmokeStatusRequestSchema,
  ExportSmokeStatusResponseSchema,
} from '@tzurot/common-types/schemas/api/internal';
import { AccountExportJobStatusSchema } from '@tzurot/common-types/schemas/api/account';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  ACCOUNT_EXPORT_SOURCE,
  type AccountExportJobData,
} from '@tzurot/common-types/types/account-export';
import { JobType, JOB_PREFIXES } from '@tzurot/common-types/constants/queue';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendContractSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { isPrismaUniqueConstraintError } from '../../utils/prismaErrors.js';
import { enqueueExportJobOrMarkFailed } from '../../utils/enqueueExportJob.js';
import { buildExportDownloadUrl } from '../../utils/exportDownloadUrl.js';
import { ensureOrphanSentinel } from '../../services/OrphanSentinelBootstrap.js';
import { createExportJobOrConflict, EXPORT_EXPIRY_HOURS } from '../user/account/export.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-export-smoke');

/**
 * The sentinel account is small BY CONSTRUCTION — it only ever holds
 * characters re-homed from purged accounts, plus (once this route runs)
 * its own personas/conversations. The bound exists to satisfy the
 * bounded-query rule, not because the sentinel is expected to approach it.
 */
const SENTINEL_QUERY_BOUND = 500;

interface ExpectedCountsSnapshot {
  personas: { id: string; name: string }[];
  characters: { id: string; slug: string }[];
  conversationCountsByPersonalityId: Record<string, number>;
  memoryCountsByPersonalityId: Record<string, number>;
  factCountsByPersonalityId: Record<string, number>;
  totals: {
    personas: number;
    characters: number;
    conversations: number;
    memories: number;
    facts: number;
  };
  isSuperuser: boolean;
}

/** Owned + co-owned character ids for the sentinel, mirroring the account-export
 *  assembler's `fetchCharacters` union of the ownership junction and direct
 *  ownership. The sentinel is small by construction, so a single bounded
 *  `findMany` per side (no cursor sweep) is enough. */
async function fetchSentinelCharacterIds(
  prisma: PrismaClient,
  sentinelId: string
): Promise<string[]> {
  const [coOwned, directlyOwned] = await Promise.all([
    prisma.personalityOwner.findMany({
      where: { userId: sentinelId },
      select: { personalityId: true },
      take: SENTINEL_QUERY_BOUND,
    }),
    prisma.personality.findMany({
      where: { ownerId: sentinelId },
      select: { id: true },
      take: SENTINEL_QUERY_BOUND,
    }),
  ]);
  return [
    ...new Set([...coOwned.map(row => row.personalityId), ...directlyOwned.map(row => row.id)]),
  ];
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

/** [{ personalityId, _count: { _all } }] → { [personalityId]: count }. */
function toCountsByPersonalityId(
  grouped: readonly { personalityId: string; _count: { _all: number } }[]
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of grouped) {
    result[row.personalityId] = row._count._all;
  }
  return result;
}

/**
 * Per-personalityId row counts across the three foldered export sections,
 * mirroring the assembler's `where: { personaId: { in: personaIds } }`
 * scoping exactly. Three explicit calls rather than one dynamic-model
 * helper — PrismaClient's generated `groupBy` overloads are per-model, and
 * a `prisma[model].groupBy(...)` dispatch loses that typing.
 */
async function fetchSentinelSectionCounts(
  prisma: PrismaClient,
  personaIds: string[]
): Promise<{
  conversationCountsByPersonalityId: Record<string, number>;
  memoryCountsByPersonalityId: Record<string, number>;
  factCountsByPersonalityId: Record<string, number>;
}> {
  if (personaIds.length === 0) {
    return {
      conversationCountsByPersonalityId: {},
      memoryCountsByPersonalityId: {},
      factCountsByPersonalityId: {},
    };
  }

  const [conversationGroups, memoryGroups, factGroups] = await Promise.all([
    prisma.conversationHistory.groupBy({
      by: ['personalityId'],
      where: { personaId: { in: personaIds } },
      _count: { _all: true },
    }),
    prisma.memory.groupBy({
      by: ['personalityId'],
      where: { personaId: { in: personaIds } },
      _count: { _all: true },
    }),
    prisma.memoryFact.groupBy({
      by: ['personalityId'],
      where: { personaId: { in: personaIds } },
      _count: { _all: true },
    }),
  ]);

  return {
    conversationCountsByPersonalityId: toCountsByPersonalityId(conversationGroups),
    memoryCountsByPersonalityId: toCountsByPersonalityId(memoryGroups),
    factCountsByPersonalityId: toCountsByPersonalityId(factGroups),
  };
}

/** Snapshot the expected export-manifest inputs from the source DB. */
async function snapshotExpectedCounts(
  prisma: PrismaClient,
  sentinelId: string
): Promise<ExpectedCountsSnapshot> {
  const [personas, characterIds, sentinelUser] = await Promise.all([
    prisma.persona.findMany({
      where: { ownerId: sentinelId },
      select: { id: true, name: true },
      take: SENTINEL_QUERY_BOUND,
    }),
    fetchSentinelCharacterIds(prisma, sentinelId),
    prisma.user.findUniqueOrThrow({ where: { id: sentinelId }, select: { isSuperuser: true } }),
  ]);

  const characters =
    characterIds.length === 0
      ? []
      : await prisma.personality.findMany({
          where: { id: { in: characterIds } },
          select: { id: true, slug: true },
          take: SENTINEL_QUERY_BOUND,
        });

  const personaIds = personas.map(persona => persona.id);
  const {
    conversationCountsByPersonalityId,
    memoryCountsByPersonalityId,
    factCountsByPersonalityId,
  } = await fetchSentinelSectionCounts(prisma, personaIds);

  return {
    personas,
    characters,
    conversationCountsByPersonalityId,
    memoryCountsByPersonalityId,
    factCountsByPersonalityId,
    totals: {
      personas: personas.length,
      characters: characters.length,
      conversations: sumCounts(conversationCountsByPersonalityId),
      memories: sumCounts(memoryCountsByPersonalityId),
      facts: sumCounts(factCountsByPersonalityId),
    },
    isSuperuser: sentinelUser.isSuperuser,
  };
}

/**
 * POST /api/internal/export-smoke/start — start a full-account export job
 * against the Orphaned-Characters sentinel account, self-healing the
 * sentinel row via `ensureOrphanSentinel` if it doesn't yet exist (cheap
 * and idempotent — an `ON CONFLICT DO NOTHING` upsert, same cost as a
 * lookup once the row exists).
 */
export const handleStartExportSmoke = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req, res: Response) => {
    const parsed = ExportSmokeStartRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }

    if (deps.aiQueue === undefined) {
      sendError(
        res,
        ErrorResponses.serviceUnavailable('Job queue required for account export is not configured')
      );
      return;
    }

    const sentinelId = await ensureOrphanSentinel(deps.prisma);
    const expiresAt = new Date(Date.now() + EXPORT_EXPIRY_HOURS * 60 * 60 * 1000);

    let exportJobId: string;
    let conflictStatus: string | null;
    try {
      ({ exportJobId, conflictStatus } = await createExportJobOrConflict(
        deps.prisma,
        sentinelId,
        expiresAt,
        false
      ));
    } catch (error: unknown) {
      if (isPrismaUniqueConstraintError(error)) {
        logger.warn({ sentinelId }, 'P2002 unique constraint — treating as conflict');
        sendError(
          res,
          ErrorResponses.conflict(
            'An export-smoke run is already in progress. Wait for it to complete.'
          )
        );
        return;
      }
      throw error;
    }

    if (conflictStatus !== null) {
      sendError(
        res,
        ErrorResponses.conflict(
          `An export-smoke run is already ${conflictStatus}. Wait for it to complete.`
        )
      );
      return;
    }

    const jobData: AccountExportJobData = { userId: sentinelId, exportJobId };
    const jobId = `${JOB_PREFIXES.ACCOUNT_EXPORT}${exportJobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await enqueueExportJobOrMarkFailed({
      queue: deps.aiQueue,
      prisma: deps.prisma,
      exportJobId,
      jobName: JobType.AccountExport,
      jobData,
      jobOptions: { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    });

    const expectedCounts = await snapshotExpectedCounts(deps.prisma, sentinelId);

    logger.info({ exportJobId }, 'Export-smoke job created');

    sendContractSuccess(res, ExportSmokeStartResponseSchema, { exportJobId, expectedCounts });
  });

/** GET /api/internal/export-smoke/status — poll the smoke's export_jobs row. */
export const handleGetExportSmokeStatus = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req, res: Response) => {
    const parsed = ExportSmokeStatusRequestSchema.safeParse(req.query);
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }

    // Scoped to the SENTINEL's own row, not just id + sourceService: account
    // export-job ids are deterministic on userId, so an id-only lookup would
    // let any internal caller resolve an arbitrary user's completed-export
    // download URL through this route. The smoke only ever polls its own
    // sentinel job, so the narrow query costs it nothing.
    const sentinelId = await ensureOrphanSentinel(deps.prisma);
    const job = await deps.prisma.exportJob.findFirst({
      where: { id: parsed.data.jobId, userId: sentinelId, sourceService: ACCOUNT_EXPORT_SOURCE },
      select: { status: true, downloadToken: true },
    });

    if (job === null) {
      sendError(res, ErrorResponses.notFound('Export-smoke job'));
      return;
    }

    // The DB column is untyped varchar; the wire contract is the enum. A row
    // carrying an unknown status should 500 loudly here (asyncHandler catches
    // the throw) rather than let the smoke poll it until timeout.
    const status = AccountExportJobStatusSchema.parse(job.status);

    sendContractSuccess(res, ExportSmokeStatusResponseSchema, {
      status,
      downloadUrl: status === 'completed' ? buildExportDownloadUrl(job.downloadToken) : null,
    });
  });
