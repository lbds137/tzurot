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
  type PrismaClient,
  type DenylistCacheInvalidationService,
} from '@tzurot/common-types';
import { extractOwnerId } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('admin-denylist');

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

    const { type, discordId, scope, scopeId, reason } = parseResult.data;
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

    // Upsert to handle re-adding with updated reason
    const entry = await prisma.denylistedEntity.upsert({
      where: { type_discordId_scope_scopeId: { type, discordId, scope, scopeId } },
      update: { reason, addedBy },
      create: { type, discordId, scope, scopeId, reason, addedBy },
    });

    await denylistInvalidation.publishAdd({
      type: entry.type,
      discordId: entry.discordId,
      scope: entry.scope,
      scopeId: entry.scopeId,
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
      const where =
        typeof typeFilter === 'string' && typeFilter.length > 0 ? { type: typeFilter } : {};

      const entries = await prisma.denylistedEntity.findMany({
        where,
        orderBy: { addedAt: 'desc' },
        take: 500,
      });

      sendCustomSuccess(res, { success: true, entries, count: entries.length });
    })
  );

  // GET /cache — Bulk fetch for bot-client hydration
  router.get(
    '/cache',
    asyncHandler(async (_req: Request, res: Response) => {
      const entries = await prisma.denylistedEntity.findMany({ take: 10000 });
      sendCustomSuccess(res, { entries });
    })
  );

  // POST / — Add denylist entry
  router.post('/', handleAddEntry(prisma, denylistInvalidation));

  // DELETE /:type/:discordId/:scope/:scopeId — Remove entry
  router.delete(
    '/:type/:discordId/:scope/:scopeId',
    asyncHandler(async (req: Request, res: Response) => {
      const type = req.params.type as string;
      const discordId = req.params.discordId as string;
      const scope = req.params.scope as string;
      const scopeId = req.params.scopeId as string;

      const existing = await prisma.denylistedEntity.findUnique({
        where: { type_discordId_scope_scopeId: { type, discordId, scope, scopeId } },
      });

      if (existing === null) {
        sendError(res, ErrorResponses.notFound('Denylist entry'));
        return;
      }

      await prisma.denylistedEntity.delete({ where: { id: existing.id } });

      await denylistInvalidation.publishRemove({ type, discordId, scope, scopeId });
      logger.info({ type, discordId, scope, scopeId }, '[Admin] Denylist entry removed');
      sendCustomSuccess(res, { success: true, removed: true });
    })
  );

  return router;
}
