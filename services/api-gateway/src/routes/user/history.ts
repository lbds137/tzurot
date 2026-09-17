/**
 * User History Routes
 * STM (Short-Term Memory) management via context epochs
 *
 * Per-persona epoch tracking: Each user's persona has independent history visibility.
 * Uses UserPersonaHistoryConfig table for per-persona epoch storage.
 *
 * POST /api/user/history/clear - Set context epoch (soft reset)
 * POST /api/user/history/undo - Restore previous epoch
 * GET /api/user/history/stats - Get history statistics
 * DELETE /api/user/history/hard-delete - Permanent, irreversible deletion
 */

import { type Response, type Request, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  ClearHistorySchema,
  UndoHistorySchema,
  HardDeleteHistorySchema,
  HistoryStatsQuerySchema,
} from '@tzurot/common-types/schemas/api/history';
import { RECENT_DAYS_DIGEST_STATUS } from '@tzurot/common-types/constants/recentDaysDigest';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateUserPersonaHistoryConfigUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { idPrefix } from '@tzurot/common-types/utils/logContentPreview';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  ConversationHistoryService,
  ConversationRetentionService,
} from '@tzurot/conversation-history';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { resolveHistoryContext } from '../../utils/historyContextResolver.js';
import type { AuthenticatedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('user-history');

const CONTEXT_NOT_FOUND =
  'User, personality, or persona not found. Check the personality slug is correct and you have a persona configured.';

/** Dependencies for history handlers */
interface HistoryHandlerDeps {
  prisma: PrismaClient;
  conversationHistoryService: ConversationHistoryService;
  retentionService: ConversationRetentionService;
}

type RouteHandler = (req: Request, res: Response) => Promise<void>;

/**
 * Null the digest text and re-queue it for regeneration. Used twice around a
 * purge: once BEFORE the delete, to invalidate any generation already in
 * flight against rows about to be purged, and once AFTER the delete resolves,
 * to invalidate a sweep tick that selected the pair between the pre-delete
 * stamp and the last committed batch — `clearHistory` commits per batch, not
 * atomically end to end, so such a tick's `requestedAt` guard would otherwise
 * pass and let it write a digest built from rows that no longer exist. The
 * two writes race harmlessly: whichever tick's write lands, the later stamp's
 * `requestedAt` bump invalidates it under the store's `requested_at IS NOT
 * DISTINCT FROM` guard.
 */
function markDigestsPendingForPurge(
  prisma: PrismaClient,
  where: { personalityId: string } | { personaId: string; personalityId: string }
): Promise<{ count: number }> {
  return prisma.personaPersonalityDigest.updateMany({
    where,
    data: {
      digestText: null,
      digestStatus: RECENT_DAYS_DIGEST_STATUS.PENDING,
      requestedAt: new Date(),
    },
  });
}

/**
 * Handle POST /api/user/history/clear
 * Set context epoch to current time (soft reset)
 */
function createClearHandler(deps: HistoryHandlerDeps): RouteHandler {
  const { prisma } = deps;

  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = ClearHistorySchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { personalitySlug, personaId: explicitPersonaId } = parseResult.data;

    const context = await resolveHistoryContext(
      prisma,
      discordUserId,
      personalitySlug,
      explicitPersonaId
    );
    if (!context) {
      return sendError(res, ErrorResponses.notFound(CONTEXT_NOT_FOUND));
    }

    const { userId, personalityId, personaId } = context;
    const now = new Date();

    // Use transaction for atomic read-modify-write
    const { previousEpoch } = await prisma.$transaction(async tx => {
      const currentConfig = await tx.userPersonaHistoryConfig.findUnique({
        where: { userId_personalityId_personaId: { userId, personalityId, personaId } },
        select: { lastContextReset: true },
      });

      const prevEpoch = currentConfig?.lastContextReset ?? null;

      await tx.userPersonaHistoryConfig.upsert({
        where: { userId_personalityId_personaId: { userId, personalityId, personaId } },
        update: { lastContextReset: now, previousContextReset: prevEpoch },
        create: {
          id: generateUserPersonaHistoryConfigUuid(userId, personalityId, personaId),
          userId,
          personalityId,
          personaId,
          lastContextReset: now,
          previousContextReset: null,
        },
      });

      // D10(a): the pair's digest dies with the epoch, in the SAME transaction —
      // a cleared, quiet pair would otherwise render its pre-clear digest forever.
      // The undo path needs nothing: a deleted digest regenerates from the
      // surviving source rows on the next sweep.
      await tx.personaPersonalityDigest.deleteMany({ where: { personaId, personalityId } });

      return { previousEpoch: prevEpoch };
    });

    logger.info(
      {
        discordUserId,
        personalitySlug,
        personaId: idPrefix(personaId),
        epoch: now.toISOString(),
      },
      'Context cleared (epoch set)'
    );

    sendCustomSuccess(
      res,
      {
        success: true,
        epoch: now.toISOString(),
        personaId,
        canUndo: previousEpoch !== null,
        message:
          'Conversation context cleared. Previous messages will not be included in AI context.',
      },
      StatusCodes.OK
    );
  });
}

/**
 * Handle POST /api/user/history/undo
 * Restore previous context epoch
 */
function createUndoHandler(deps: HistoryHandlerDeps): RouteHandler {
  const { prisma } = deps;

  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = UndoHistorySchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { personalitySlug, personaId: explicitPersonaId } = parseResult.data;

    const context = await resolveHistoryContext(
      prisma,
      discordUserId,
      personalitySlug,
      explicitPersonaId
    );
    if (!context) {
      return sendError(res, ErrorResponses.notFound(CONTEXT_NOT_FOUND));
    }

    const { userId, personalityId, personaId } = context;

    const result = await prisma.$transaction(async tx => {
      const currentConfig = await tx.userPersonaHistoryConfig.findUnique({
        where: { userId_personalityId_personaId: { userId, personalityId, personaId } },
        select: { lastContextReset: true, previousContextReset: true },
      });

      if (
        currentConfig?.lastContextReset === null ||
        currentConfig?.lastContextReset === undefined
      ) {
        return { success: false as const, reason: 'no-clear' as const };
      }

      const restoredEpoch = currentConfig.previousContextReset;
      const undoneEpoch = currentConfig.lastContextReset;

      await tx.userPersonaHistoryConfig.update({
        where: { userId_personalityId_personaId: { userId, personalityId, personaId } },
        data: { lastContextReset: restoredEpoch, previousContextReset: null },
      });

      // An epoch is an INCLUSIVE lower bound on visibility (`createdAt >= epoch`),
      // the convention recorded in `historyCutoff.ts`. So the rows the swap made
      // visible again are the band `>= restoredEpoch` and `< undoneEpoch`: a row
      // sitting exactly on the restored epoch is visible now, and one sitting
      // exactly on the undone epoch was already visible before this undo. Both
      // bounds are pinned by the two undo-count tests in `history.test.ts`.
      //
      // The count runs inside the transaction so that a count failure aborts the
      // callback before it commits: the epoch swap must not persist while the
      // request errors, or the retry hits the "no previous context" rejection
      // with the history still hidden. The pre-commit ordering is pinned by
      // `does not commit the swap when the count fails`; the rollback itself is
      // Prisma's transaction semantics, which the mocked unit tests cannot
      // observe.
      const restoredCount = await tx.conversationHistory.count({
        where: {
          personaId,
          personalityId,
          deletedAt: null,
          createdAt: {
            ...(restoredEpoch !== null ? { gte: restoredEpoch } : {}),
            lt: undoneEpoch,
          },
        },
      });

      return { success: true as const, restoredEpoch, restoredCount };
    });

    if (!result.success) {
      return sendError(
        res,
        ErrorResponses.validationError(
          'No previous context to restore. Undo is only available after a clear operation.'
        )
      );
    }

    logger.info(
      {
        discordUserId,
        personalitySlug,
        personaId: idPrefix(personaId),
        restoredEpoch: result.restoredEpoch?.toISOString(),
        restoredCount: result.restoredCount,
      },
      'Context restored (undo)'
    );

    sendCustomSuccess(
      res,
      {
        success: true,
        restoredEpoch: result.restoredEpoch?.toISOString() ?? null,
        personaId,
        restoredCount: result.restoredCount,
        message: 'Previous context restored. The last clear operation has been undone.',
      },
      StatusCodes.OK
    );
  });
}

/**
 * Handle GET /api/user/history/stats
 * Get conversation history statistics
 */
function createStatsHandler(deps: HistoryHandlerDeps): RouteHandler {
  const { prisma, conversationHistoryService } = deps;

  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = HistoryStatsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { personalitySlug, channelId, personaId: explicitPersonaId } = parseResult.data;

    const context = await resolveHistoryContext(
      prisma,
      discordUserId,
      personalitySlug,
      explicitPersonaId
    );
    if (!context) {
      return sendError(res, ErrorResponses.notFound(CONTEXT_NOT_FOUND));
    }

    const { userId, personalityId, personaId, personaName } = context;

    const historyConfig = await prisma.userPersonaHistoryConfig.findUnique({
      where: { userId_personalityId_personaId: { userId, personalityId, personaId } },
      select: { lastContextReset: true, previousContextReset: true },
    });

    const epoch = historyConfig?.lastContextReset ?? undefined;

    const [visibleStats, totalStats] = await Promise.all([
      conversationHistoryService.getHistoryStats(channelId, personalityId, epoch),
      conversationHistoryService.getHistoryStats(channelId, personalityId, undefined),
    ]);

    const hiddenMessages = totalStats.totalMessages - visibleStats.totalMessages;

    logger.debug(
      { discordUserId, personalitySlug, channelId, personaId: idPrefix(personaId) },
      'Stats retrieved'
    );

    sendCustomSuccess(
      res,
      {
        channelId,
        personalitySlug,
        personaId,
        personaName,
        visible: {
          totalMessages: visibleStats.totalMessages,
          userMessages: visibleStats.userMessages,
          assistantMessages: visibleStats.assistantMessages,
          oldestMessage: visibleStats.oldestMessage?.toISOString() ?? null,
          newestMessage: visibleStats.newestMessage?.toISOString() ?? null,
        },
        hidden: { count: hiddenMessages },
        total: {
          totalMessages: totalStats.totalMessages,
          oldestMessage: totalStats.oldestMessage?.toISOString() ?? null,
        },
        contextEpoch: epoch?.toISOString() ?? null,
        canUndo:
          historyConfig?.previousContextReset !== null &&
          historyConfig?.previousContextReset !== undefined,
      },
      StatusCodes.OK
    );
  });
}

/**
 * Handle DELETE /api/user/history/hard-delete
 * Permanently delete conversation history
 *
 * Authorization for `scope: 'everyone'` lives in bot-client, not here: the
 * gateway cannot see Discord channel permissions. Every request to this router
 * is service-authenticated (`requireServiceAuth` is applied app-wide in
 * `services/api-gateway/src/index.ts`), and bot-client is its only caller, so
 * the check sits where the permission data is. The channel-wide case is logged
 * at info with `{ scope, channelId, personalityId, discordUserId }` so the
 * delete is auditable from the gateway side regardless.
 */
function createHardDeleteHandler(deps: HistoryHandlerDeps): RouteHandler {
  const { prisma, retentionService } = deps;

  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = HardDeleteHistorySchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { personalitySlug, channelId, personaId: explicitPersonaId, scope } = parseResult.data;

    const context = await resolveHistoryContext(
      prisma,
      discordUserId,
      personalitySlug,
      explicitPersonaId
    );
    if (!context) {
      return sendError(res, ErrorResponses.notFound(CONTEXT_NOT_FOUND));
    }

    const { personalityId, personaId } = context;

    if (scope === 'everyone') {
      logger.info(
        { scope, channelId, personalityId, discordUserId },
        'Channel-wide history purge requested'
      );
    }

    // D10(b): the purged rows may have produced the pair's digest, so null the
    // text and re-queue it rather than deleting the row — nothing renders until
    // the next sweep regenerates from what survived. This runs BEFORE the
    // delete on purpose: `clearHistory` commits per batch, not atomically end
    // to end, so a mid-sweep throw must never leave a `done` digest built from
    // rows that are about to be purged. A channel-wide purge invalidates every
    // pair of the personality: over-invalidation regenerates from surviving
    // rows, under-invalidation would render a purged turn. The stamp is
    // repeated after the delete resolves below, closing the window where a
    // sweep tick selects the pair between this stamp and the last committed
    // batch.
    const digestWhere = scope === 'everyone' ? { personalityId } : { personaId, personalityId };
    await markDigestsPendingForPurge(prisma, digestWhere);

    // A channel-wide purge omits the persona filter entirely —
    // `clearHistory` adds `personaId` to the where-clause only when one is
    // given, so two arguments IS the every-user delete.
    const deletedCount =
      scope === 'everyone'
        ? await retentionService.clearHistory(channelId, personalityId)
        : await retentionService.clearHistory(channelId, personalityId, personaId);

    // Second stamp: invalidates a sweep tick that selected the pair after the
    // pre-delete stamp but before the last committed batch, and whose success
    // write would otherwise pass the store's `requested_at` guard against the
    // stale pre-delete value.
    await markDigestsPendingForPurge(prisma, digestWhere);

    // Purge is channel-scoped, but UserPersonaHistoryConfig is keyed by
    // (userId, personalityId, personaId) with no channel dimension — writing
    // an epoch here would hide history in every OTHER channel for this
    // persona too, not just the one being purged. The row delete above
    // already covers the purged channel; the epoch stays untouched.

    logger.info(
      {
        discordUserId,
        personalitySlug,
        channelId,
        personaId: idPrefix(personaId),
        scope,
        deletedCount,
      },
      'Hard delete completed'
    );

    sendCustomSuccess(
      res,
      {
        success: true,
        deletedCount,
        personaId: scope === 'everyone' ? null : personaId,
        message: `Permanently deleted ${deletedCount} message${deletedCount === 1 ? '' : 's'} from conversation history.`,
        scope,
      },
      StatusCodes.OK
    );
  });
}

function buildHistoryDeps(deps: RouteDeps): HistoryHandlerDeps {
  return {
    prisma: deps.prisma,
    conversationHistoryService: new ConversationHistoryService(deps.prisma),
    retentionService: deps.retentionService ?? new ConversationRetentionService(deps.prisma),
  };
}

/** POST /api/user/history/clear — soft-reset context via epoch */
export const handleClearHistory = (deps: RouteDeps): RequestHandler =>
  createClearHandler(buildHistoryDeps(deps));

/** POST /api/user/history/undo — restore previous context epoch */
export const handleUndoHistory = (deps: RouteDeps): RequestHandler =>
  createUndoHandler(buildHistoryDeps(deps));

/** GET /api/user/history/stats — conversation history statistics */
export const handleGetHistoryStats = (deps: RouteDeps): RequestHandler =>
  createStatsHandler(buildHistoryDeps(deps));

/** DELETE /api/user/history/hard-delete — permanent deletion */
export const handleHardDeleteHistory = (deps: RouteDeps): RequestHandler =>
  createHardDeleteHandler(buildHistoryDeps(deps));
