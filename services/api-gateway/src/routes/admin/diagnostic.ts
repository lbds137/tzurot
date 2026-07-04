/**
 * Admin Diagnostic Routes
 * Owner-only endpoints for accessing LLM diagnostic logs (flight recorder)
 *
 * Endpoints:
 * - GET /admin/diagnostic/recent - List recent diagnostic logs (last 100)
 * - GET /admin/diagnostic/by-message/:messageId - Get logs by Discord trigger message ID
 * - GET /admin/diagnostic/by-response/:messageId - Get logs by AI response message ID
 * - GET /admin/diagnostic/:requestId - Get diagnostic log by request ID
 * - PATCH /admin/diagnostic/:requestId/response-ids - Update response message IDs
 *
 * Note: Diagnostic logs are ephemeral (24h retention) and stored for debugging
 * prompt construction issues.
 */

import { Router, type Response, type Request, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { isValidUUID } from '@tzurot/common-types/constants/service';
import { DiagnosticUpdateSchema } from '@tzurot/common-types/schemas/api/admin';
import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { requireServiceAuth, requireUserAuth } from '../../services/AuthMiddleware.js';
import type { AuthenticatedRequest } from '../../types.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('admin-diagnostic');

/** Maximum number of recent logs to return */
const MAX_RECENT_LOGS = 100;

/**
 * Error message for the fail-closed guard when requireUserAuth somehow lets
 * a request through without populating req.userId. In normal operation this
 * is unreachable — the guard exists to prevent a future middleware bug from
 * silently degrading the per-user WHERE-clause filter into "no filter."
 */
const MISSING_CALLER_IDENTITY = 'Missing caller identity';

/**
 * Resolve the caller's Discord user ID from `req.userId` (set by
 * `requireUserAuth`). Sends a 500 and returns null if missing — handlers
 * should bail immediately on null. This is the fail-closed guard that
 * keeps the per-user WHERE filter from silently degrading into "no filter"
 * when middleware mis-wiring drops the userId.
 */
function resolveCallerUserId(req: Request, res: Response): string | null {
  const id = (req as AuthenticatedRequest).userId;
  if (id === undefined || id === '') {
    sendError(res, ErrorResponses.internalError(MISSING_CALLER_IDENTITY));
    return null;
  }
  return id;
}

/** Response format for a single diagnostic log */
interface DiagnosticLogResponse {
  id: string;
  requestId: string;
  triggerMessageId: string | null;
  personalityId: string | null;
  userId: string | null;
  guildId: string | null;
  channelId: string | null;
  model: string;
  provider: string;
  durationMs: number;
  createdAt: Date;
  data: DiagnosticPayload;
}

/**
 * Format a diagnostic log for API response
 */
function formatLogResponse(log: {
  id: string;
  requestId: string;
  triggerMessageId: string | null;
  personalityId: string | null;
  userId: string | null;
  guildId: string | null;
  channelId: string | null;
  model: string;
  provider: string;
  durationMs: number;
  createdAt: Date;
  data: unknown;
}): DiagnosticLogResponse {
  return {
    id: log.id,
    requestId: log.requestId,
    triggerMessageId: log.triggerMessageId,
    personalityId: log.personalityId,
    userId: log.userId,
    guildId: log.guildId,
    channelId: log.channelId,
    model: log.model,
    provider: log.provider,
    durationMs: log.durationMs,
    createdAt: log.createdAt,
    // DiagnosticPayload is written by our own ai-worker pipeline as JSONB — trusted internal data
    data: log.data as DiagnosticPayload,
  };
}

/** Raw query row shape for recent logs (snake_case from PostgreSQL) */
interface RecentLogRow {
  id: string;
  request_id: string;
  personality_id: string | null;
  user_id: string | null;
  guild_id: string | null;
  channel_id: string | null;
  model: string;
  provider: string;
  duration_ms: number;
  created_at: Date;
  personality_name: string | null;
}

/** API response format for a recent diagnostic log summary */
interface RecentLogResponse {
  id: string;
  requestId: string;
  personalityId: string | null;
  userId: string | null;
  guildId: string | null;
  channelId: string | null;
  model: string;
  provider: string;
  durationMs: number;
  createdAt: Date;
  personalityName: string | null;
}

/** Map a raw query row to the camelCase API response format */
function formatRecentLogResponse(row: RecentLogRow): RecentLogResponse {
  return {
    id: row.id,
    requestId: row.request_id,
    personalityId: row.personality_id,
    userId: row.user_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    model: row.model,
    provider: row.provider,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    personalityName: row.personality_name,
  };
}

/**
 * Handler: GET /admin/diagnostic/recent
 * List recent diagnostic logs (last 100) with personality name extracted from JSONB
 */
export const handleGetRecentDiagnostics = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    const callerUserId = resolveCallerUserId(req, res);
    if (callerUserId === null) {
      return;
    }
    const ownerAccess = isBotOwner(callerUserId);

    const personalityId = getParam(req.query.personalityId as string | undefined);
    const queryUserId = getParam(req.query.userId as string | undefined);
    const channelId = getParam(req.query.channelId as string | undefined);

    // Non-owners can only see their own logs. The `?userId=` query param is
    // ignored for non-owners — the filter is forced to the caller's ID. The
    // owner may pass `?userId=` to inspect another user's logs.
    const effectiveUserId = ownerAccess ? queryUserId : callerUserId;

    // Validate UUID format before casting — returns 400 instead of a PostgreSQL cast error (500)
    if (personalityId !== undefined && personalityId !== '' && !isValidUUID(personalityId)) {
      sendError(
        res,
        ErrorResponses.validationError('Invalid personalityId format (expected UUID)')
      );
      return;
    }

    const conditions: Prisma.Sql[] = [];
    if (personalityId !== undefined && personalityId !== '') {
      conditions.push(Prisma.sql`personality_id = ${personalityId}::uuid`);
    }
    if (effectiveUserId !== undefined && effectiveUserId !== '') {
      conditions.push(Prisma.sql`user_id = ${effectiveUserId}`);
    }
    if (channelId !== undefined && channelId !== '') {
      conditions.push(Prisma.sql`channel_id = ${channelId}`);
    }

    const whereClause =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    // Raw query needed to extract personalityName from JSONB (data #>> '{meta,personalityName}')
    // which isn't possible through the Prisma ORM's findMany API.
    const rows = await prisma.$queryRaw<RecentLogRow[]>`
      SELECT
        id, request_id, personality_id, user_id, guild_id, channel_id,
        model, provider, duration_ms, created_at,
        data #>> '{meta,personalityName}' AS personality_name
      FROM llm_diagnostic_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${MAX_RECENT_LOGS}
    `;

    const logs = rows.map(formatRecentLogResponse);

    logger.info(
      {
        count: logs.length,
        filters: { personalityId, userId: effectiveUserId, channelId },
        ownerAccess,
      },
      'Listed recent diagnostic logs'
    );

    sendCustomSuccess(res, { logs, count: logs.length }, StatusCodes.OK);
  });
};

/**
 * Handler: GET /admin/diagnostic/by-message/:messageId
 * Get all diagnostic logs for a Discord message ID
 */
export const handleGetDiagnosticByMessage = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    const callerUserId = resolveCallerUserId(req, res);
    if (callerUserId === null) {
      return;
    }
    const ownerAccess = isBotOwner(callerUserId);

    const messageId = getParam(req.params.messageId);

    if (messageId === undefined || messageId === '') {
      sendError(res, ErrorResponses.validationError('Message ID is required'));
      return;
    }

    // Non-owners only see their own logs; owners see any log. The filter is
    // applied at the database layer rather than client-side so we don't ship
    // other users' diagnostic payloads across the service boundary.
    const logs = await prisma.llmDiagnosticLog.findMany({
      where: {
        triggerMessageId: messageId,
        ...(ownerAccess ? {} : { userId: callerUserId }),
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_RECENT_LOGS,
    });

    if (logs.length === 0) {
      sendError(
        res,
        ErrorResponses.notFound('Diagnostic logs for message (may have expired - 24h retention)')
      );
      return;
    }

    logger.info(
      { messageId, count: logs.length, ownerAccess },
      'Retrieved diagnostic logs by message ID'
    );

    sendCustomSuccess(
      res,
      { logs: logs.map(formatLogResponse), count: logs.length },
      StatusCodes.OK
    );
  });
};

/**
 * Handler: GET /admin/diagnostic/:requestId
 * Get full diagnostic log by request ID
 */
export const handleGetDiagnosticByRequestId = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    const callerUserId = resolveCallerUserId(req, res);
    if (callerUserId === null) {
      return;
    }
    const ownerAccess = isBotOwner(callerUserId);

    const requestId = getParam(req.params.requestId);

    if (requestId === undefined || requestId === '') {
      sendError(res, ErrorResponses.validationError('Request ID is required'));
      return;
    }

    // Push the userId filter into the WHERE clause for non-owners so Prisma
    // doesn't fetch the (potentially large) diagnostic `data` JSON for rows
    // the caller can't see anyway. 404-not-403 existence-hiding is preserved
    // because findUnique returns null for both "doesn't exist" and "exists
    // but not yours" once the userId is part of the unique key.
    //
    // `userId` is NOT a unique field on its own — Prisma's extended-WHERE
    // behavior (GA since Prisma 5) treats non-unique fields in findUnique's
    // where clause as AND filters layered on top of the unique-key lookup.
    // Type-safe and intentional, despite looking like the older "findUnique
    // accepts unique fields only" pattern.
    const log = await prisma.llmDiagnosticLog.findUnique({
      where: ownerAccess ? { requestId } : { requestId, userId: callerUserId },
    });

    if (!log) {
      sendError(res, ErrorResponses.notFound('Diagnostic log (may have expired - 24h retention)'));
      return;
    }

    logger.info(
      { requestId, personalityId: log.personalityId, ownerAccess },
      'Retrieved diagnostic log'
    );

    sendCustomSuccess(res, { log: formatLogResponse(log) }, StatusCodes.OK);
  });
};

/**
 * Handler: GET /admin/diagnostic/by-response/:messageId
 * Get diagnostic log by AI response message ID (array containment query)
 */
export const handleGetDiagnosticByResponse = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    const callerUserId = resolveCallerUserId(req, res);
    if (callerUserId === null) {
      return;
    }
    const ownerAccess = isBotOwner(callerUserId);

    const messageId = getParam(req.params.messageId);

    if (messageId === undefined || messageId === '') {
      sendError(res, ErrorResponses.validationError('Message ID is required'));
      return;
    }

    // Use array containment query - responseMessageIds contains messageId
    // findFirst is acceptable since response message IDs are unique per Discord message;
    // even if multiple chunks exist, they all point to the same diagnostic log
    const log = await prisma.llmDiagnosticLog.findFirst({
      where: {
        responseMessageIds: { has: messageId },
        ...(ownerAccess ? {} : { userId: callerUserId }),
      },
      // Deterministic tiebreak: if multiple rows ever share a response message
      // ID, return the most recent — matches handleGetByMessage's ordering.
      orderBy: { createdAt: 'desc' },
    });

    if (!log) {
      sendError(
        res,
        ErrorResponses.notFound(
          'Diagnostic log for response message (may have expired - 24h retention)'
        )
      );
      return;
    }

    logger.info(
      { messageId, requestId: log.requestId, ownerAccess },
      'Retrieved diagnostic log by response message ID'
    );

    sendCustomSuccess(res, { log: formatLogResponse(log) }, StatusCodes.OK);
  });
};

/**
 * Handler: PATCH /admin/diagnostic/:requestId/response-ids
 * Update the response message IDs for a diagnostic log
 * Called by bot-client after sending response to Discord
 */
export const handleUpdateDiagnosticResponseIds = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    const requestId = getParam(req.params.requestId);

    if (requestId === undefined || requestId === '') {
      sendError(res, ErrorResponses.validationError('Request ID is required'));
      return;
    }

    const parseResult = DiagnosticUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { responseMessageIds } = parseResult.data;

    try {
      await prisma.llmDiagnosticLog.update({
        where: { requestId },
        data: { responseMessageIds },
      });

      logger.info({ requestId, responseMessageIds }, 'Updated response message IDs');

      sendCustomSuccess(res, { success: true }, StatusCodes.OK);
    } catch (error) {
      // Handle not found case (Prisma throws if record doesn't exist)
      if ((error as { code?: string }).code === 'P2025') {
        sendError(
          res,
          ErrorResponses.notFound('Diagnostic log (may have expired - 24h retention)')
        );
        return;
      }
      throw error;
    }
  });
};

/**
 * Create diagnostic routes with injected dependencies
 * @param prisma - Prisma client for database operations
 */
export function createDiagnosticRoutes(prisma: PrismaClient): Router {
  const router = Router();

  // GET routes use requireUserAuth — any authenticated user can call /inspect.
  // Each handler then filters by userId for non-owners (server-side filtering,
  // not client-side, so other users' diagnostic payloads never cross the
  // service boundary). The bot owner sees all logs unfiltered.
  //
  // Service-secret enforcement is provided by the global `requireServiceAuth`
  // mounted in `index.ts` ahead of route mounting — `requireUserAuth` alone
  // does NOT validate the shared secret. If these routes are ever extracted
  // to a sub-app or alternate mount that bypasses the global guard, callers
  // could query diagnostic logs with only `X-User-Id`. The queued adminFetch /
  // route-prefix refactor addresses this structurally via explicit prefix
  // semantics (`/api/internal`, `/api/admin`, `/api/user`).
  router.get('/recent', requireUserAuth(), handleGetRecentDiagnostics({ prisma }));
  router.get('/by-message/:messageId', requireUserAuth(), handleGetDiagnosticByMessage({ prisma }));
  router.get(
    '/by-response/:messageId',
    requireUserAuth(),
    handleGetDiagnosticByResponse({ prisma })
  );
  // Note: /:requestId must come after /by-* routes to avoid matching 'by-message' as a requestId
  router.get('/:requestId', requireUserAuth(), handleGetDiagnosticByRequestId({ prisma }));

  // PATCH is an internal call from bot-client to api-gateway after AI response
  // delivery — no human user is involved. requireServiceAuth() validates
  // X-Service-Auth (the shared service secret) rather than gating on a user.
  //
  // Trust assumption: any holder of INTERNAL_SERVICE_SECRET can overwrite
  // responseMessageIds on any diagnostic log row by requestId. In practice
  // bot-client is the only legitimate caller, and it only PATCHes requestIds
  // it generated itself — so the realistic blast radius is "if the service
  // secret leaks, attacker can corrupt diagnostic row response-id arrays."
  // Cannot create phantom rows (prisma.update throws P2025 on missing).
  // Cannot read other users' data via this route. The queued adminFetch /
  // route-prefix refactor will make this trust contract explicit by giving
  // service-only routes a distinct prefix and middleware path.
  router.patch(
    '/:requestId/response-ids',
    requireServiceAuth(),
    handleUpdateDiagnosticResponseIds({ prisma })
  );

  return router;
}
