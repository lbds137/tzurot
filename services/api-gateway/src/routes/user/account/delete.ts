/**
 * Account Data-Rights Deletion Routes
 *
 * GET  /api/user/account/delete/preview - counts + per-character blast radius
 * POST /api/user/account/delete/token   - typed phrase → single-use token
 * POST /api/user/account/delete         - consumes token, erases the account
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
import type { ProvisionedRequest } from '../../../types.js';
import { resolveProvisionedUserId } from '../../../utils/resolveProvisionedUserId.js';
import { requireRedis } from '../memoryBatchHelpers.js';
import { ActionTokenService } from '../../../services/ActionTokenService.js';
import {
  AccountDeletionService,
  SuperuserDeletionError,
  type AccountDeletionSummary,
} from '../../../services/AccountDeletionService.js';
import { AccountEraserService } from '../../../services/AccountEraserService.js';

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

    const deleteToken = await new ActionTokenService(redis).issueAccountDeleteToken(req.userId);
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
    const tokenService = new ActionTokenService(redis);

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
      // self-serve mode: deletes owned characters for everyone (the user is
      // warned loudly at token-issue time). The service owns both the DB
      // transaction and the off-DB cleanup (avatar unlink, cache eviction +
      // broadcast) — see AccountEraserService.
      summary = await new AccountEraserService(deps).erase({
        userId,
        discordUserId,
        mode: 'self-serve',
      });
    } catch (error) {
      if (error instanceof SuperuserDeletionError) {
        sendError(res, ErrorResponses.forbidden(error.message));
        return;
      }
      throw error;
    }

    const { characterSlugs: _slugs, characterIds: _ids, ...clientSummary } = summary;
    sendCustomSuccess(res, { success: true, summary: clientSummary }, StatusCodes.OK);
  });
