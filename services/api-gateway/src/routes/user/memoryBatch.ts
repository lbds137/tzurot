/**
 * Batch Memory Operations
 *
 * Destructive batch flows use a preview/execute token handshake. The
 * preview endpoint runs the filter against the DB, returns a summary, and
 * issues a short-lived token whose Redis value is the bound filter. The
 * execute endpoint accepts ONLY the token — it never sees the filter from
 * the client — eliminating drift between preview and execute.
 *
 * Endpoints:
 *   POST /user/memory/delete/preview  → impact summary + previewToken
 *   POST /user/memory/delete          → consumes previewToken, soft-deletes
 *   POST /user/memory/purge/token     → confirmation phrase + purgeToken
 *   POST /user/memory/purge           → consumes purgeToken, soft-deletes
 *
 * Locked memories are always skipped (never touched by either flow).
 *
 * Handlers follow the (deps: RouteDeps) => RequestHandler shape so codegen
 * can wire them up from the route manifest. The MemoryActionTokenService is
 * instantiated per-request (cheap; no shared state beyond Redis), mirroring
 * the IncognitoSessionManager pattern.
 */

import type { RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  BatchDeletePreviewSchema,
  BatchDeleteSchema,
  IssuePurgeTokenSchema,
  PurgeMemoriesSchema,
} from '@tzurot/common-types/schemas/api/memory';
import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { RouteDeps } from '../routeDeps.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { ProvisionedRequest } from '../../types.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { getDefaultPersonaId, getPersonalityById, parseTimeframeFilter } from './memoryHelpers.js';
import {
  requireRedis,
  resolvePersonaIdForBatch as resolvePersonaIdForBatchHelper,
  executeBatchDelete,
} from './memoryBatchHelpers.js';
import { MemoryActionTokenService } from '../../services/MemoryActionTokenService.js';

const logger = createLogger('memory-batch');

/** Local wrapper that threads getDefaultPersonaId through to the helper. */
async function resolvePersonaIdForBatch(
  prisma: PrismaClient,
  userId: string,
  requestedPersonaId: string | undefined,
  res: Response
): Promise<string | null> {
  return resolvePersonaIdForBatchHelper(
    prisma,
    userId,
    requestedPersonaId,
    res,
    getDefaultPersonaId
  );
}

/**
 * Handler for POST /user/memory/delete/preview
 *
 * Body: { personalityId, personaId?, timeframe? }
 * Returns: { wouldDelete, lockedWouldSkip, previewToken, ... }
 *
 * The previewToken is the ONLY way to invoke POST /user/memory/delete —
 * the filter is stored server-side under the token key, so the execute
 * path is guaranteed to operate on the same filter the user previewed.
 */
export const handleBatchDeletePreview = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const redis = requireRedis(deps, res);
    if (redis === null) {
      return;
    }
    const tokenService = new MemoryActionTokenService(redis);

    const discordUserId = req.userId;

    const parseResult = BatchDeletePreviewSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }

    const { personalityId, personaId: requestedPersonaId, timeframe } = parseResult.data;

    const userId = resolveProvisionedUserId(req);

    const personality = await getPersonalityById(prisma, personalityId, res);
    if (!personality) {
      return;
    }

    const personaId = await resolvePersonaIdForBatch(prisma, userId, requestedPersonaId, res);
    if (personaId === null) {
      return;
    }

    const where: Prisma.MemoryWhereInput = {
      personaId,
      personalityId,
      visibility: 'normal',
      isLocked: false,
    };

    const timeframeParsed = parseTimeframeFilter(timeframe);
    if (timeframeParsed.error !== undefined) {
      sendError(res, ErrorResponses.validationError(timeframeParsed.error));
      return;
    }
    if (timeframeParsed.filter !== null) {
      where.createdAt = timeframeParsed.filter;
    }

    const [wouldDelete, lockedWouldSkip] = await Promise.all([
      prisma.memory.count({ where }),
      prisma.memory.count({
        where: {
          personaId,
          personalityId,
          visibility: 'normal',
          isLocked: true,
          ...(timeframeParsed.filter !== null ? { createdAt: timeframeParsed.filter } : {}),
        },
      }),
    ]);

    const previewToken = await tokenService.issuePreviewToken(discordUserId, {
      personalityId,
      personaId,
      timeframe,
    });

    logger.debug(
      {
        discordUserId,
        personalityId,
        personaId: personaId.substring(0, 8),
        wouldDelete,
        lockedWouldSkip,
      },
      '[Memory] Batch delete preview issued'
    );

    sendCustomSuccess(
      res,
      {
        wouldDelete,
        lockedWouldSkip,
        personalityId,
        personalityName: personality.name,
        timeframe: timeframe ?? 'all',
        previewToken,
      },
      StatusCodes.OK
    );
  });
};

/**
 * Handler for POST /user/memory/delete
 *
 * Body: { previewToken }
 * Peek-validate-consume: peek the token, validate personality + persona,
 * then atomically consume. If validation fails the token stays in Redis
 * (subject to its 5-min TTL) so the user can retry without restarting the
 * preview flow.
 */
export const handleBatchDelete = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const redis = requireRedis(deps, res);
    if (redis === null) {
      return;
    }
    const tokenService = new MemoryActionTokenService(redis);

    const discordUserId = req.userId;

    const parseResult = BatchDeleteSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }

    const { previewToken } = parseResult.data;

    const filter = await tokenService.peekPreviewToken(discordUserId, previewToken);
    if (filter === null) {
      sendError(
        res,
        ErrorResponses.validationError(
          'Preview token is invalid, expired, or already used. Re-run the preview to get a fresh token.'
        )
      );
      return;
    }

    const { personalityId, personaId: filterPersonaId, timeframe } = filter;
    const userId = resolveProvisionedUserId(req);

    const personality = await getPersonalityById(prisma, personalityId, res);
    if (!personality) {
      return;
    }

    // Token-bound personaId should match the user's own persona; re-verify
    // ownership defense-in-depth in case the token was issued in an older
    // session that no longer reflects the current persona state.
    const personaId = await resolvePersonaIdForBatch(prisma, userId, filterPersonaId, res);
    if (personaId === null) {
      return;
    }

    // Preconditions OK — claim the token atomically. The only failure here is
    // a concurrent consume by the same user (double-click), which is benign:
    // the destructive op below is idempotent on already-deleted rows.
    const consumed = await tokenService.consumePreviewToken(discordUserId, previewToken);
    if (consumed === null) {
      sendError(
        res,
        ErrorResponses.validationError(
          'Preview token was consumed by a concurrent request. Re-run the preview to get a fresh token.'
        )
      );
      return;
    }

    await executeBatchDelete({
      prisma,
      res,
      discordUserId,
      personalityId,
      personalityName: personality.name,
      personaId,
      timeframe,
    });
  });
};

/**
 * Handler for POST /user/memory/purge/token
 *
 * Body: { personalityId, confirmationPhrase }
 * Returns: { purgeToken, personalityName, ... }
 *
 * Validates the confirmation phrase against the personality name. On success,
 * issues a short-lived purge token bound to the personality. The actual
 * destructive purge requires the token at POST /user/memory/purge.
 */
export const handleIssuePurgeToken = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const redis = requireRedis(deps, res);
    if (redis === null) {
      return;
    }
    const tokenService = new MemoryActionTokenService(redis);

    const discordUserId = req.userId;

    const parseResult = IssuePurgeTokenSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }

    const { personalityId, confirmationPhrase } = parseResult.data;

    const personality = await getPersonalityById(prisma, personalityId, res);
    if (!personality) {
      return;
    }

    const expectedPhrase = `DELETE ${personality.name.toUpperCase()} MEMORIES`;
    if (confirmationPhrase.toUpperCase() !== expectedPhrase.toUpperCase()) {
      sendError(
        res,
        ErrorResponses.validationError(`Confirmation required. Type: "${expectedPhrase}"`)
      );
      return;
    }

    const purgeToken = await tokenService.issuePurgeToken(discordUserId, personalityId);

    logger.info(
      { discordUserId, personalityId, personalityName: personality.name },
      '[Memory] Purge token issued'
    );

    sendCustomSuccess(
      res,
      { purgeToken, personalityId, personalityName: personality.name },
      StatusCodes.OK
    );
  });
};

/**
 * Handler for POST /user/memory/purge
 *
 * Body: { purgeToken }
 * Peek-validate-consume pattern (mirrors handleBatchDelete). Soft-deletes
 * all non-locked memories for the personality bound to the token.
 */
export const handlePurge = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const redis = requireRedis(deps, res);
    if (redis === null) {
      return;
    }
    const tokenService = new MemoryActionTokenService(redis);

    const discordUserId = req.userId;

    const parseResult = PurgeMemoriesSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }

    const { purgeToken } = parseResult.data;

    const peeked = await tokenService.peekPurgeToken(discordUserId, purgeToken);
    if (peeked === null) {
      sendError(
        res,
        ErrorResponses.validationError(
          'Purge token is invalid, expired, or already used. Re-issue via /memory/purge/token.'
        )
      );
      return;
    }

    const { personalityId } = peeked;
    const userId = resolveProvisionedUserId(req);

    const personality = await getPersonalityById(prisma, personalityId, res);
    if (!personality) {
      return;
    }

    // Purge always operates on the user's *default* persona. Batch-delete
    // (above) supports a token-supplied persona override because the preview
    // flow lets the user filter by persona; purge has no equivalent filter —
    // it's an all-memories destructive op scoped to the personality. If a
    // future variant needs persona-scoped purge, mirror resolvePersonaIdForBatch.
    const defaultPersonaId = await getDefaultPersonaId(prisma, userId);
    if (defaultPersonaId === null) {
      sendError(res, ErrorResponses.validationError('No persona found. Create one first.'));
      return;
    }

    // Preconditions OK — claim the token. Concurrent-consume race is benign
    // because updateMany of already-deleted rows is a no-op.
    const consumed = await tokenService.consumePurgeToken(discordUserId, purgeToken);
    if (consumed === null) {
      sendError(
        res,
        ErrorResponses.validationError(
          'Purge token was consumed by a concurrent request. Re-issue via /memory/purge/token.'
        )
      );
      return;
    }

    const [totalCount, lockedCount] = await Promise.all([
      prisma.memory.count({
        where: { personaId: defaultPersonaId, personalityId, visibility: 'normal' },
      }),
      prisma.memory.count({
        where: {
          personaId: defaultPersonaId,
          personalityId,
          visibility: 'normal',
          isLocked: true,
        },
      }),
    ]);

    const result = await prisma.memory.updateMany({
      where: {
        personaId: defaultPersonaId,
        personalityId,
        visibility: 'normal',
        isLocked: false,
      },
      data: { visibility: 'deleted', updatedAt: new Date() },
    });

    logger.warn(
      {
        discordUserId,
        personalityId,
        personalityName: personality.name,
        personaId: defaultPersonaId.substring(0, 8),
        totalBefore: totalCount,
        deletedCount: result.count,
        lockedPreserved: lockedCount,
      },
      'PURGE completed'
    );

    sendCustomSuccess(
      res,
      {
        deletedCount: result.count,
        lockedPreserved: lockedCount,
        personalityId,
        personalityName: personality.name,
        message:
          lockedCount > 0
            ? `Purged ${result.count} memories for ${personality.name}. ${lockedCount} locked (core) memories were preserved.`
            : `Purged all ${result.count} memories for ${personality.name}.`,
      },
      StatusCodes.OK
    );
  });
};
