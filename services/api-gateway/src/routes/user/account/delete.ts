/**
 * Account Data-Rights Deletion Routes
 *
 * GET  /user/account/delete/preview - counts + per-character blast radius
 * POST /user/account/delete/token   - typed phrase → single-use token
 * POST /user/account/delete         - consumes token, erases the account
 *
 * Purge-pattern handshake (mirrors /memory/purge): the destructive call
 * accepts ONLY the token; the phrase validation happened at token-issue
 * time. Superusers are blocked at every step — the owner account owns the
 * global characters, and a self-delete would erase them for everyone.
 */

import type { RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  ACCOUNT_DELETE_CONFIRMATION_PHRASE,
  IssueAccountDeleteTokenSchema,
  DeleteAccountSchema,
} from '@tzurot/common-types/schemas/api/account';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { RouteDeps } from '../../routeDeps.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { sendZodError } from '../../../utils/zodHelpers.js';
import { deleteAllAvatarVersions } from '../../../utils/avatarPaths.js';
import type { ProvisionedRequest } from '../../../types.js';
import { resolveProvisionedUserId } from '../../../utils/resolveProvisionedUserId.js';
import { requireRedis } from '../memoryBatchHelpers.js';
import { MemoryActionTokenService } from '../../../services/MemoryActionTokenService.js';
import {
  AccountDeletionService,
  SuperuserDeletionError,
  type AccountDeletionSummary,
} from '../../../services/AccountDeletionService.js';
import { IncognitoSessionManager } from '../../../services/IncognitoSessionManager.js';
import { getOrCreateUserService } from '../../../services/AuthMiddleware.js';
import { UserCacheInvalidationService } from '@tzurot/cache-invalidation';

const logger = createLogger('account-delete');

/**
 * 403 for superuser accounts at every step of the flow — the block must
 * precede the warning embed (preview), the token mint, AND the deletion
 * itself (the service re-checks inside the transaction as backstop).
 * Returns true when the request may proceed.
 */
async function rejectSuperuser(
  prisma: PrismaClient,
  userId: string,
  res: Response
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperuser: true },
  });
  if (user?.isSuperuser === true) {
    sendError(
      res,
      ErrorResponses.forbidden(
        'This account is the bot owner (superuser) and owns the global characters — ' +
          'it cannot be deleted. Remove the superuser flag first if you truly intend this.'
      )
    );
    return false;
  }
  return true;
}

/**
 * Best-effort post-transaction cleanup: cached state that outlives the DB
 * rows but self-heals or TTL-expires. Failures are logged, never surfaced —
 * the account is already gone. Runs concurrently (every task swallows its
 * own error) so per-character work doesn't stack sequentially onto the
 * response's wall-clock time.
 */
async function cleanupAfterDeletion(
  deps: RouteDeps,
  discordUserId: string,
  summary: AccountDeletionSummary
): Promise<void> {
  const tasks: Promise<void>[] = [
    (async () => {
      try {
        if (deps.redis !== undefined) {
          await new IncognitoSessionManager(deps.redis).disableAll(discordUserId);
        }
      } catch (error) {
        logger.warn({ err: error }, 'Post-deletion incognito cleanup failed');
      }
    })(),
    ...summary.characterIds.map(async personalityId => {
      try {
        await deps.cacheInvalidationService?.invalidatePersonality(personalityId);
      } catch (error) {
        logger.warn({ err: error, personalityId }, 'Post-deletion cache invalidation failed');
      }
    }),
    // Avatars are served filesystem-first; without the unlink, deleted
    // characters' avatars stay publicly downloadable forever.
    ...summary.characterSlugs.map(async slug => {
      try {
        await deleteAllAvatarVersions(slug, 'Account delete');
      } catch (error) {
        logger.warn({ err: error, slug }, 'Post-deletion avatar unlink failed');
      }
    }),
  ];
  await Promise.all(tasks);
}

/** GET /api/user/account/delete/preview */
export const handlePreviewAccountDelete = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const userId = resolveProvisionedUserId(req);
    if (!(await rejectSuperuser(deps.prisma, userId, res))) {
      return;
    }
    const preview = await new AccountDeletionService(deps.prisma).preview(userId);
    sendCustomSuccess(res, preview, StatusCodes.OK);
  });

/** POST /api/user/account/delete/token */
export const handleIssueAccountDeleteToken = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const redis = requireRedis(deps, res);
    if (redis === null) {
      return;
    }

    const parseResult = IssueAccountDeleteTokenSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }

    const userId = resolveProvisionedUserId(req);
    if (!(await rejectSuperuser(deps.prisma, userId, res))) {
      return;
    }

    const entered = parseResult.data.confirmationPhrase.trim();
    if (entered.toUpperCase() !== ACCOUNT_DELETE_CONFIRMATION_PHRASE) {
      sendError(
        res,
        ErrorResponses.validationError(
          `Confirmation required. Type: "${ACCOUNT_DELETE_CONFIRMATION_PHRASE}"`
        )
      );
      return;
    }

    const deleteToken = await new MemoryActionTokenService(redis).issueAccountDeleteToken(
      req.userId
    );
    logger.info({ discordUserId: req.userId }, 'Account delete token issued');
    sendCustomSuccess(res, { deleteToken }, StatusCodes.OK);
  });

/** POST /api/user/account/delete */
export const handleDeleteAccount = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const redis = requireRedis(deps, res);
    if (redis === null) {
      return;
    }

    const parseResult = DeleteAccountSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }

    const discordUserId = req.userId;
    const { deleteToken } = parseResult.data;
    const tokenService = new MemoryActionTokenService(redis);

    // Peek-validate-consume: precondition failures must not burn the token.
    if (!(await tokenService.peekAccountDeleteToken(discordUserId, deleteToken))) {
      sendError(
        res,
        ErrorResponses.validationError(
          'Deletion token is invalid, expired, or already used. Restart the flow.'
        )
      );
      return;
    }

    const userId = resolveProvisionedUserId(req);
    if (!(await rejectSuperuser(deps.prisma, userId, res))) {
      return;
    }

    if (!(await tokenService.consumeAccountDeleteToken(discordUserId, deleteToken))) {
      sendError(
        res,
        ErrorResponses.validationError(
          'Deletion token was consumed by a concurrent request. Restart the flow.'
        )
      );
      return;
    }

    let summary: AccountDeletionSummary;
    try {
      summary = await new AccountDeletionService(deps.prisma).deleteAccount(userId, discordUserId);
    } catch (error) {
      if (error instanceof SuperuserDeletionError) {
        sendError(res, ErrorResponses.forbidden(error.message));
        return;
      }
      throw error;
    }

    // CORRECTNESS-CRITICAL (not best-effort): the provisioning cache still
    // maps this discordId to the just-deleted userId. Without eviction, the
    // user's very next request returns the dead id and any write against it
    // FK-violates (observed: an export retried right after deletion 500'd on
    // export_jobs_user_id_fkey).
    //   (1) Evict THIS process synchronously (tightest fix; no round-trip).
    getOrCreateUserService(deps.prisma).invalidateUser(discordUserId);
    //   (2) Broadcast so every OTHER process (ai-worker's context pipeline
    //       has its own long-lived UserService) drops the mapping too — else
    //       a queued generation job within the ~1h TTL re-hits the dead id.
    //       `redis` is already non-null (requireRedis returned early above).
    try {
      await new UserCacheInvalidationService(redis).invalidateUser(discordUserId);
    } catch (error) {
      // Swallowed on purpose: THIS process was evicted synchronously above and
      // the account is already gone, so the delete must still return 200. Blast
      // radius of a failed broadcast: other processes' UserService caches (e.g.
      // ai-worker's context pipeline) stay stale until the 1h TTL expires — a
      // queued generation job for this discordId in that window can still
      // FK-violate on the usage-log insert. Bounded and self-healing; not worth
      // failing the deletion over.
      logger.warn({ err: error }, 'Post-deletion user-cache broadcast failed');
    }

    await cleanupAfterDeletion(deps, discordUserId, summary);

    const { characterSlugs: _slugs, characterIds: _ids, ...clientSummary } = summary;
    sendCustomSuccess(res, { success: true, summary: clientSummary }, StatusCodes.OK);
  });
