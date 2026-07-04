/**
 * Denylist Admin Routes
 *
 * CRUD endpoints for managing denylisted users and guilds.
 * All endpoints require service authentication (applied globally).
 * User-facing endpoints additionally require bot-owner auth (defense-in-depth
 * against post-INTERNAL_SERVICE_SECRET-compromise privilege escalation).
 * The /cache endpoint is service-only — bot-client hydrates the denylist
 * cache at startup, before any Discord user context exists.
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';
import {
  DenylistAddSchema,
  denylistEntityTypeSchema,
  denylistScopeSchema,
} from '@tzurot/common-types/schemas/api/denylist';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { type DenylistCacheInvalidationService } from '@tzurot/cache-invalidation';
import { extractOwnerId, requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { createRedisDenylistRateLimiter } from '../../utils/RedisRateLimiter.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('admin-denylist');

/** Max entries returned in paginated list view */
const LIST_MAX_ENTRIES = 500;

/** Max entries returned for bot-client cache hydration (all entries) */
const CACHE_HYDRATION_MAX_ENTRIES = 10_000;

/**
 * Handle POST / — Add or update a denylist entry
 */
function handleAddEntry(
  prisma: PrismaClient,
  denylistInvalidation: DenylistCacheInvalidationService
): (req: Request, res: Response) => Promise<void> {
  return asyncHandler(async (req: Request, res: Response) => {
    const parseResult = DenylistAddSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { type, discordId, scope, scopeId, mode, reason } = parseResult.data;
    const addedBy = extractOwnerId(req) ?? 'unknown';

    // Prevent denying the bot owner
    if (type === 'USER' && isBotOwner(discordId)) {
      sendError(res, ErrorResponses.validationError('Cannot deny the bot owner'));
      return;
    }

    // Validate scope combinations
    if (type === 'GUILD' && scope !== 'BOT') {
      sendError(res, ErrorResponses.validationError('GUILD type only supports BOT scope'));
      return;
    }

    if (scope === 'BOT' && scopeId !== '*') {
      sendError(res, ErrorResponses.validationError('BOT scope requires scopeId to be "*"'));
      return;
    }

    if (scope !== 'BOT' && scopeId === '*') {
      sendError(res, ErrorResponses.validationError(`${scope} scope requires a specific scopeId`));
      return;
    }

    // Upsert to handle re-adding with updated reason/mode
    const entry = await prisma.denylistedEntity.upsert({
      where: { type_discordId_scope_scopeId: { type, discordId, scope, scopeId } },
      update: { reason, mode, addedBy },
      create: { type, discordId, scope, scopeId, mode, reason, addedBy },
    });

    await denylistInvalidation.publishAdd({
      type: entry.type,
      discordId: entry.discordId,
      scope: entry.scope,
      scopeId: entry.scopeId,
      mode: entry.mode,
    });

    logger.info({ type, discordId, scope, scopeId, addedBy }, 'Denylist entry added');
    sendCustomSuccess(res, { success: true, entry });
  });
}

/**
 * Create denylist admin routes
 */
/** GET /api/admin/denylist — list all entries (optional ?type= filter) */
export const handleListDenylistEntries = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    const typeFilter = req.query.type;
    let where = {};
    if (typeof typeFilter === 'string' && typeFilter.length > 0) {
      const parsed = denylistEntityTypeSchema.safeParse(typeFilter);
      if (!parsed.success) {
        sendError(
          res,
          ErrorResponses.validationError('Invalid type filter — must be USER or GUILD')
        );
        return;
      }
      where = { type: parsed.data };
    }

    const entries = await prisma.denylistedEntity.findMany({
      where,
      orderBy: { addedAt: 'desc' },
      take: LIST_MAX_ENTRIES,
    });

    sendCustomSuccess(res, { success: true, entries, count: entries.length });
  });
};

/** GET /api/admin/denylist/cache — bulk fetch for bot-client hydration (service-only) */
export const handleGetDenylistCache = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (_req: Request, res: Response) => {
    const entries = await prisma.denylistedEntity.findMany({ take: CACHE_HYDRATION_MAX_ENTRIES });
    if (entries.length >= CACHE_HYDRATION_MAX_ENTRIES) {
      logger.warn(
        { count: entries.length, limit: CACHE_HYDRATION_MAX_ENTRIES },
        'Cache hydration hit max entry limit — some entries may not be cached'
      );
    }
    sendCustomSuccess(res, { entries });
  });
};

/** POST /api/admin/denylist — add/update a denylist entry */
export const handleAddDenylistEntry = (deps: RouteDeps): RequestHandler => {
  const { prisma, denylistInvalidation } = deps;
  if (denylistInvalidation === undefined) {
    return (_req, res) => {
      sendError(res, ErrorResponses.serviceUnavailable('Denylist invalidation not configured'));
    };
  }
  return handleAddEntry(prisma, denylistInvalidation);
};

/** DELETE /api/admin/denylist/:type/:discordId/:scope/:scopeId — remove entry */
export const handleRemoveDenylistEntry = (deps: RouteDeps): RequestHandler => {
  const { prisma, denylistInvalidation } = deps;
  if (denylistInvalidation === undefined) {
    return (_req, res) => {
      sendError(res, ErrorResponses.serviceUnavailable('Denylist invalidation not configured'));
    };
  }
  return asyncHandler(async (req: Request, res: Response) => {
    const typeResult = denylistEntityTypeSchema.safeParse(req.params.type);
    if (!typeResult.success) {
      sendError(res, ErrorResponses.validationError('Invalid type — must be USER or GUILD'));
      return;
    }
    const scopeResult = denylistScopeSchema.safeParse(req.params.scope);
    if (!scopeResult.success) {
      sendError(
        res,
        ErrorResponses.validationError(
          'Invalid scope — must be BOT, GUILD, CHANNEL, or PERSONALITY'
        )
      );
      return;
    }
    const type = typeResult.data;
    const discordId = req.params.discordId as string;
    const scope = scopeResult.data;
    const scopeId = req.params.scopeId as string;

    const existing = await prisma.denylistedEntity.findUnique({
      where: { type_discordId_scope_scopeId: { type, discordId, scope, scopeId } },
    });

    if (existing === null) {
      sendError(res, ErrorResponses.notFound('Denylist entry'));
      return;
    }

    await prisma.denylistedEntity.delete({ where: { id: existing.id } });

    await denylistInvalidation.publishRemove({
      type,
      discordId,
      scope,
      scopeId,
      mode: existing.mode,
    });
    logger.info({ type, discordId, scope, scopeId }, 'Denylist entry removed');
    sendCustomSuccess(res, { success: true, removed: true });
  });
};

/**
 * Legacy factory composing the 4 denylist endpoints with per-route
 * middleware (the rate limiter ties them together at the factory
 * level, so callers that haven't migrated to the bare handlers can
 * keep the existing mount shape).
 */
export function createDenylistRoutes(deps: RouteDeps): Router {
  const router = Router();
  const rateLimiter =
    deps.redis !== undefined ? createRedisDenylistRateLimiter(deps.redis) : undefined;
  const mutationMiddleware = rateLimiter !== undefined ? [rateLimiter] : [];

  router.get('/', requireOwnerAuth(), handleListDenylistEntries(deps));
  router.get('/cache', handleGetDenylistCache(deps));
  router.post('/', requireOwnerAuth(), ...mutationMiddleware, handleAddDenylistEntry(deps));
  router.delete(
    '/:type/:discordId/:scope/:scopeId',
    requireOwnerAuth(),
    ...mutationMiddleware,
    handleRemoveDenylistEntry(deps)
  );

  return router;
}
