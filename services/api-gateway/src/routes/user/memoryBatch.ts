/**
 * Batch Memory Operations
 *
 * Destructive batch flows use a preview/execute token handshake. The
 * preview endpoint runs the filter against the DB, returns a summary, and
 * issues a short-lived token whose Redis value is the bound filter. The
 * execute endpoint accepts ONLY the token — it never sees the filter from
 * the client — eliminating drift between preview and execute.
 *
 * Endpoints (mounted in memory.ts):
 *   POST /user/memory/delete/preview  → impact summary + previewToken
 *   POST /user/memory/delete          → consumes previewToken, soft-deletes
 *   POST /user/memory/purge/token     → confirmation phrase + purgeToken
 *   POST /user/memory/purge           → consumes purgeToken, soft-deletes
 *
 * Locked memories are always skipped (never touched by either flow).
 */

import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  Prisma,
  BatchDeletePreviewSchema,
  BatchDeleteSchema,
  IssuePurgeTokenSchema,
  PurgeMemoriesSchema,
} from '@tzurot/common-types';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { ProvisionedRequest } from '../../types.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { getDefaultPersonaId, getPersonalityById, parseTimeframeFilter } from './memoryHelpers.js';
import type { MemoryActionTokenService } from '../../services/MemoryActionTokenService.js';

const logger = createLogger('memory-batch');

/** Service-unavailable response when Redis (and therefore the token service) is absent. */
function sendRedisUnavailable(res: Response): void {
  sendError(
    res,
    ErrorResponses.serviceUnavailable('Batch memory operations require Redis; service unavailable.')
  );
}

/**
 * Resolve and validate the personaId for a batch delete preview.
 * Returns null and sends an error response on failure.
 */
async function resolvePersonaIdForBatch(
  prisma: PrismaClient,
  userId: string,
  requestedPersonaId: string | undefined,
  res: Response
): Promise<string | null> {
  let personaId = requestedPersonaId;
  if (personaId === undefined || personaId === '') {
    const defaultPersonaId = await getDefaultPersonaId(prisma, userId);
    if (defaultPersonaId === null) {
      sendError(res, ErrorResponses.validationError('No persona found. Create one first.'));
      return null;
    }
    personaId = defaultPersonaId;
  }

  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { id: true, ownerId: true },
  });

  if (persona?.ownerId !== userId) {
    sendError(res, ErrorResponses.forbidden('Persona not found or does not belong to you'));
    return null;
  }

  return personaId;
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
 
export async function handleBatchDeletePreview(
  prisma: PrismaClient,
  tokenService: MemoryActionTokenService | null,
  req: ProvisionedRequest,
  res: Response
): Promise<void> {
  if (tokenService === null) {
    sendRedisUnavailable(res);
    return;
  }

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
}

/**
 * Handler for POST /user/memory/delete
 *
 * Body: { previewToken }
 * The filter that produced the preview is re-read from Redis under the
 * token key and applied verbatim. The token is consumed atomically — it
 * cannot be replayed.
 */
// eslint-disable-next-line max-lines-per-function -- Procedural handler: validate token → re-apply filter → soft-delete
export async function handleBatchDelete(
  prisma: PrismaClient,
  tokenService: MemoryActionTokenService | null,
  req: ProvisionedRequest,
  res: Response
): Promise<void> {
  if (tokenService === null) {
    sendRedisUnavailable(res);
    return;
  }

  const discordUserId = req.userId;

  const parseResult = BatchDeleteSchema.safeParse(req.body);
  if (!parseResult.success) {
    sendZodError(res, parseResult.error);
    return;
  }

  const { previewToken } = parseResult.data;
  const filter = await tokenService.consumePreviewToken(discordUserId, previewToken);
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

  const countToDelete = await prisma.memory.count({ where });

  if (countToDelete === 0) {
    sendCustomSuccess(
      res,
      {
        deletedCount: 0,
        skippedLocked: 0,
        message: 'No memories found matching the criteria',
      },
      StatusCodes.OK
    );
    return;
  }

  const lockedCount = await prisma.memory.count({
    where: {
      personaId,
      personalityId,
      visibility: 'normal',
      isLocked: true,
      ...(timeframeParsed.filter !== null ? { createdAt: timeframeParsed.filter } : {}),
    },
  });

  const result = await prisma.memory.updateMany({
    where,
    data: { visibility: 'deleted', updatedAt: new Date() },
  });

  logger.warn(
    {
      discordUserId,
      personalityId,
      personalityName: personality.name,
      personaId: personaId.substring(0, 8),
      timeframe: timeframe ?? 'all',
      deletedCount: result.count,
      skippedLocked: lockedCount,
    },
    '[Memory] Batch delete completed'
  );

  sendCustomSuccess(
    res,
    {
      deletedCount: result.count,
      skippedLocked: lockedCount,
      personalityId,
      personalityName: personality.name,
      message:
        lockedCount > 0
          ? `Deleted ${result.count} memories. ${lockedCount} locked memories were skipped.`
          : `Deleted ${result.count} memories.`,
    },
    StatusCodes.OK
  );
}

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
export async function handleIssuePurgeToken(
  prisma: PrismaClient,
  tokenService: MemoryActionTokenService | null,
  req: ProvisionedRequest,
  res: Response
): Promise<void> {
  if (tokenService === null) {
    sendRedisUnavailable(res);
    return;
  }

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
}

/**
 * Handler for POST /user/memory/purge
 *
 * Body: { purgeToken }
 * Consumes the token, then soft-deletes all non-locked memories for the
 * personality bound to that token.
 */
 
export async function handlePurge(
  prisma: PrismaClient,
  tokenService: MemoryActionTokenService | null,
  req: ProvisionedRequest,
  res: Response
): Promise<void> {
  if (tokenService === null) {
    sendRedisUnavailable(res);
    return;
  }

  const discordUserId = req.userId;

  const parseResult = PurgeMemoriesSchema.safeParse(req.body);
  if (!parseResult.success) {
    sendZodError(res, parseResult.error);
    return;
  }

  const { purgeToken } = parseResult.data;
  const consumed = await tokenService.consumePurgeToken(discordUserId, purgeToken);
  if (consumed === null) {
    sendError(
      res,
      ErrorResponses.validationError(
        'Purge token is invalid, expired, or already used. Re-issue via /memory/purge/token.'
      )
    );
    return;
  }

  const { personalityId } = consumed;
  const userId = resolveProvisionedUserId(req);

  const personality = await getPersonalityById(prisma, personalityId, res);
  if (!personality) {
    return;
  }

  const defaultPersonaId = await getDefaultPersonaId(prisma, userId);
  if (defaultPersonaId === null) {
    sendError(res, ErrorResponses.validationError('No persona found. Create one first.'));
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
}
