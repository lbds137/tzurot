/**
 * Memory-fact correction handlers (memory Phase 2 correction slice).
 *
 * The user-facing curation surface over `memory_facts`: list/get, plus the
 * correction verbs. Facts live in ai-worker's FactStore domain, but these
 * operations are simple targeted writes that need none of the extraction
 * machinery (revival, similarity fallback, budget), so the gateway owns them
 * directly — mirroring how `/memory/:id` PATCH/DELETE mutate `prisma.memory`.
 * The gateway's EmbeddingService uses the SAME local model as ai-worker
 * (BGE-small-en-v1.5, 384-dim), so a gateway-written corrected-fact embedding
 * is directly comparable to extraction-written ones.
 *
 * Lock semantics — IDENTICAL to episode-memory locks (one word, one meaning):
 * `is_locked` is a hard freeze. A locked fact rejects /memory correct and
 * /memory forget (unlock first) and is never auto-superseded by extraction.
 * Corrections don't need the lock: the `corrected` TIER is what shields them
 * from extraction (user assertion outranks model assertion, permanently), so
 * re-correcting your own correction needs no unlock ceremony.
 */

import type { RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  CorrectFactRequestSchema,
  SetFactLockRequestSchema,
} from '@tzurot/common-types/schemas/api/fact';
import { generateMemoryFactUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { RouteDeps } from '../routeDeps.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { getParam } from '../../utils/requestParams.js';
import type { ProvisionedRequest } from '../../types.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { getDefaultPersonaId } from './memoryHelpers.js';
import {
  generateEmbedding,
  formatAsVector,
  isEmbeddingServiceAvailable,
} from '../../services/EmbeddingService.js';

const logger = createLogger('user-memory-facts');

const FACT_RESOURCE = 'Fact';
const FACT_ID_REQUIRED = 'Fact ID is required';
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

/** The active-fact predicate — the same one FactStore reads with. */
const ACTIVE_FACT_WHERE = {
  supersededAt: null,
  forgotten: false,
  visibility: 'normal',
} as const;

/** A fact row shaped for FactItemSchema. */
interface FactRow {
  id: string;
  personalityId: string;
  personaId: string | null;
  statement: string;
  entityTags: string[];
  salience: number;
  tier: string;
  isLocked: boolean;
  isFiction: boolean;
  validFrom: Date;
  supersededAt: Date | null;
  supersededById: string | null;
  forgotten: boolean;
  sourceMemoryIds: string[];
  createdAt: Date;
}

function transformFact(fact: FactRow): Record<string, unknown> {
  return {
    id: fact.id,
    personalityId: fact.personalityId,
    personaId: fact.personaId,
    statement: fact.statement,
    entityTags: fact.entityTags,
    salience: fact.salience,
    tier: fact.tier,
    isLocked: fact.isLocked,
    validFrom: fact.validFrom.toISOString(),
    supersededAt: fact.supersededAt === null ? null : fact.supersededAt.toISOString(),
    supersededById: fact.supersededById,
    forgotten: fact.forgotten,
    sourceMemoryIds: fact.sourceMemoryIds,
    createdAt: fact.createdAt.toISOString(),
  };
}

interface OwnershipContext {
  prisma: PrismaClient;
  req: ProvisionedRequest;
  factId: string;
  res: Response;
}

/**
 * Fetch an ACTIVE fact scoped to the caller's default persona, or send a 404
 * and return null. Persona ownership is the scope check — a fact's persona is
 * the user's identity toward the personality (same model as episode memories).
 */
async function findOwnedActiveFact(context: OwnershipContext): Promise<FactRow | null> {
  const { prisma, req, factId, res } = context;
  const userId = resolveProvisionedUserId(req);

  const personaId = await getDefaultPersonaId(prisma, userId);
  if (personaId === null) {
    sendError(res, ErrorResponses.notFound(FACT_RESOURCE));
    return null;
  }

  const fact = await prisma.memoryFact.findFirst({
    where: { id: factId, personaId, ...ACTIVE_FACT_WHERE },
  });
  if (fact === null) {
    sendError(res, ErrorResponses.notFound(FACT_RESOURCE));
    return null;
  }
  return fact;
}

/** GET /user/fact/list?personalityId&limit&offset — paginated active facts. */
export const handleListFacts = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const query = req.query as { personalityId?: string; limit?: string; offset?: string };
    const personalityId = query.personalityId;
    if (personalityId === undefined || personalityId.length === 0) {
      sendError(res, ErrorResponses.validationError('personalityId is required'));
      return;
    }

    const userId = resolveProvisionedUserId(req);
    const personaId = await getDefaultPersonaId(prisma, userId);
    if (personaId === null) {
      sendCustomSuccess(
        res,
        { facts: [], total: 0, limit: DEFAULT_LIST_LIMIT, offset: 0, hasMore: false },
        StatusCodes.OK
      );
      return;
    }

    const limit = clampLimit(query.limit);
    const offset = Math.max(0, Number.parseInt(query.offset ?? '0', 10) || 0);
    const where = { personalityId, personaId, ...ACTIVE_FACT_WHERE };

    const [facts, total] = await Promise.all([
      prisma.memoryFact.findMany({
        where,
        orderBy: { validFrom: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.memoryFact.count({ where }),
    ]);

    sendCustomSuccess(
      res,
      {
        facts: facts.map(f => transformFact(f as FactRow)),
        total,
        limit,
        offset,
        hasMore: offset + facts.length < total,
      },
      StatusCodes.OK
    );
  });
};

function clampLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(parsed, MAX_LIST_LIMIT);
}

/** GET /user/fact/:id — single fact for the detail view. */
export const handleGetFact = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const factId = getParam(req.params.id);
    if (factId === undefined || factId.length === 0) {
      sendError(res, ErrorResponses.validationError(FACT_ID_REQUIRED));
      return;
    }
    const fact = await findOwnedActiveFact({ prisma, req, factId, res });
    if (fact === null) {
      return;
    }
    sendCustomSuccess(res, { fact: transformFact(fact) }, StatusCodes.OK);
  });
};

/**
 * PATCH /user/fact/:id — correct: supersede the fact with a NEW corrected-tier
 * fact carrying the same entity tags / source provenance. The corrected tier
 * itself is what shields it from automatic extraction supersession (user
 * assertion outranks model assertion) — no lock involved, so re-correcting
 * needs no unlock ceremony. Requires an embedding (503 if unavailable) — a
 * correction with no vector would never be retrieved, defeating the correction.
 *
 * Statement-collision semantics (the id is a content hash, so correcting a
 * DIFFERENT fact to a statement that already has a row collides on that id).
 * The invariant: a correct always leaves the surviving fact shielded from
 * auto-supersession (corrected tier or locked) — otherwise a collision would
 * silently reopen the death spiral the user just closed.
 * - colliding row is ACTIVE + LOCKED → merge: the conflict-update no-ops (a
 *   locked row is never touched), and the corrected fact is simply marked
 *   superseded by it. Already shielded by its lock.
 * - colliding row is UNLOCKED (active or dead) → claimed as the correction:
 *   reactivated/promoted to corrected-tier with the correction's values. For
 *   a dead row this is user revival — unlike extraction (whose revival
 *   respects forgotten as terminal and never touches corrected rows), an
 *   explicit user assertion of the statement overrides a prior forget: the
 *   user typing the text IS the change of mind.
 */
export const handleCorrectFact = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const factId = getParam(req.params.id);
    if (factId === undefined || factId.length === 0) {
      sendError(res, ErrorResponses.validationError(FACT_ID_REQUIRED));
      return;
    }

    const parseResult = CorrectFactRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const { statement } = parseResult.data;

    const old = await findOwnedActiveFact({ prisma, req, factId, res });
    if (old === null) {
      return;
    }

    // Same hard-freeze contract as locked episode memories: unlock first.
    if (old.isLocked) {
      sendError(res, ErrorResponses.forbidden('Cannot correct a locked fact — unlock it first'));
      return;
    }

    if (statement === old.statement) {
      sendError(
        res,
        ErrorResponses.validationError('The corrected statement is identical to the current one')
      );
      return;
    }

    if (!isEmbeddingServiceAvailable()) {
      sendError(res, ErrorResponses.serviceUnavailable('Correction temporarily unavailable'));
      return;
    }
    const embedding = await generateEmbedding(statement);
    if (embedding === null) {
      sendError(res, ErrorResponses.serviceUnavailable('Correction temporarily unavailable'));
      return;
    }
    const vector = formatAsVector(embedding);

    const newId = generateMemoryFactUuid(old.personalityId, old.personaId, statement);
    const now = new Date();

    await prisma.$transaction([
      prisma.$executeRaw`
        INSERT INTO memory_facts
          (id, personality_id, persona_id, pool, is_fiction, statement, embedding,
           entity_tags, salience, tier, is_locked, valid_from, source_memory_ids,
           extraction_job_id, created_at, updated_at)
        VALUES
          (${newId}::uuid, ${old.personalityId}::uuid, ${old.personaId}::uuid, 'private',
           ${old.isFiction}, ${statement}, ${vector}::vector,
           ${old.entityTags}::text[], ${old.salience}, 'corrected', false, ${now},
           ${old.sourceMemoryIds}::text[], NULL, ${now}, ${now})
        ON CONFLICT (id) DO UPDATE SET
          superseded_at = NULL,
          superseded_by_id = NULL,
          forgotten = false,
          tier = 'corrected',
          is_locked = false,
          statement = EXCLUDED.statement,
          embedding = EXCLUDED.embedding,
          entity_tags = EXCLUDED.entity_tags,
          is_fiction = EXCLUDED.is_fiction,
          salience = EXCLUDED.salience,
          valid_from = EXCLUDED.valid_from,
          source_memory_ids = EXCLUDED.source_memory_ids,
          extraction_job_id = NULL,
          updated_at = EXCLUDED.updated_at
        WHERE memory_facts.superseded_at IS NOT NULL
           OR memory_facts.is_locked = false
      `,
      prisma.memoryFact.updateMany({
        // supersededAt: null is the optimistic-concurrency predicate — a racing
        // correct/forget that already killed `old` makes this a no-op instead
        // of double-superseding.
        where: { id: old.id, supersededAt: null },
        data: { supersededAt: now, supersededById: newId },
      }),
    ]);

    const corrected = await prisma.memoryFact.findUnique({ where: { id: newId } });
    if (corrected === null) {
      sendError(res, ErrorResponses.internalError('Corrected fact vanished after write'));
      return;
    }

    logger.info(
      { discordUserId: req.userId, factId: old.id, correctedId: newId },
      'Fact corrected'
    );
    sendCustomSuccess(
      res,
      { fact: transformFact(corrected as FactRow), supersededFactId: old.id },
      StatusCodes.OK
    );
  });
};

/**
 * DELETE /user/fact/:id — forget: terminal per-fact removal. Sets
 * `forgotten=true` + `superseded_at` so the fact never re-enters retrieval or
 * supersession context, and re-extracting the identical statement no-ops
 * against the dead row. Per-fact only; the source episode is untouched.
 */
export const handleForgetFact = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const factId = getParam(req.params.id);
    if (factId === undefined || factId.length === 0) {
      sendError(res, ErrorResponses.validationError(FACT_ID_REQUIRED));
      return;
    }
    const fact = await findOwnedActiveFact({ prisma, req, factId, res });
    if (fact === null) {
      return;
    }

    // Same hard-freeze contract as locked episode memories: unlock first.
    if (fact.isLocked) {
      sendError(res, ErrorResponses.forbidden('Cannot forget a locked fact — unlock it first'));
      return;
    }

    // supersededAt: null is the optimistic-concurrency predicate — if an
    // extraction batch superseded this fact between our read and this write,
    // the no-op preserves the real successor pointer instead of stomping it
    // with null.
    const result = await prisma.memoryFact.updateMany({
      where: { id: fact.id, supersededAt: null },
      data: { forgotten: true, supersededAt: new Date(), supersededById: null },
    });
    if (result.count === 0) {
      // Raced path: the successor pointer stays, but the forget intent must
      // still land — a superseded-but-not-forgotten row is legally revivable
      // by extraction, which would resurrect exactly what the user removed.
      await prisma.memoryFact.updateMany({
        where: { id: fact.id },
        data: { forgotten: true },
      });
      logger.info(
        { discordUserId: req.userId, factId: fact.id },
        'Forget raced a supersession — successor pointer preserved, forgotten still set'
      );
    } else {
      logger.info({ discordUserId: req.userId, factId: fact.id }, 'Fact forgotten');
    }
    sendCustomSuccess(res, { id: fact.id, forgotten: true }, StatusCodes.OK);
  });
};

/**
 * PUT /user/fact/:id/lock — set the extraction-protection lock explicitly.
 * Idempotent: replaying the same body lands the same state.
 */
export const handleSetFactLock = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const factId = getParam(req.params.id);
    if (factId === undefined || factId.length === 0) {
      sendError(res, ErrorResponses.validationError(FACT_ID_REQUIRED));
      return;
    }

    const parseResult = SetFactLockRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const { locked } = parseResult.data;

    const fact = await findOwnedActiveFact({ prisma, req, factId, res });
    if (fact === null) {
      return;
    }

    if (fact.isLocked === locked) {
      sendCustomSuccess(res, { fact: transformFact(fact) }, StatusCodes.OK);
      return;
    }

    const updated = await prisma.memoryFact.update({
      where: { id: fact.id },
      data: { isLocked: locked },
    });

    logger.info(
      { discordUserId: req.userId, factId: fact.id, action: locked ? 'locked' : 'unlocked' },
      'Fact lock state set'
    );
    sendCustomSuccess(res, { fact: transformFact(updated as FactRow) }, StatusCodes.OK);
  });
};
