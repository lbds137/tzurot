/**
 * Denylist Admin Routes
 *
 * CRUD endpoints for managing denylisted users and guilds.
 * All endpoints require service authentication (applied globally).
 * Bot-client handles three-tier permission checking before calling these.
 */

import { Router, type Request, type Response } from 'express';
import {
  createLogger,
  isBotOwner,
  DenylistAddSchema,
  denylistEntityTypeSchema,
  denylistScopeSchema,
  type PrismaClient,
  type DenylistCacheInvalidationService,
} from '@tzurot/common-types';
import { extractOwnerId } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

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
): (req: Request, res: Response) => void {
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

    logger.info({ type, discordId, scope, scopeId, addedBy }, '[Admin] Denylist entry added');
    sendCustomSuccess(res, { success: true, entry });
  });
}

/**
 * Create denylist admin routes
 */
export function createDenylistRoutes(
  prisma: PrismaClient,
  denylistInvalidation: DenylistCacheInvalidationService
): Router {
  const router = Router();

  // GET / — List all entries (optional ?type= filter)
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
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
    })
  );

  // GET /cache — Bulk fetch for bot-client hydration
  router.get(
    '/cache',
    asyncHandler(async (_req: Request, res: Response) => {
      const entries = await prisma.denylistedEntity.findMany({ take: CACHE_HYDRATION_MAX_ENTRIES });
      sendCustomSuccess(res, { entries });
    })
  );

  // POST / — Add denylist entry
  router.post('/', handleAddEntry(prisma, denylistInvalidation));

  // DELETE /:type/:discordId/:scope/:scopeId — Remove entry
  router.delete(
    '/:type/:discordId/:scope/:scopeId',
    asyncHandler(async (req: Request, res: Response) => {
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
      logger.info({ type, discordId, scope, scopeId }, '[Admin] Denylist entry removed');
      sendCustomSuccess(res, { success: true, removed: true });
    })
  );

  return router;
}
