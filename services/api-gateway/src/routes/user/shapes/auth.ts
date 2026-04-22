/**
 * Shapes.inc Credential Routes
 *
 * POST   /user/shapes/auth   - Store encrypted session cookie
 * DELETE /user/shapes/auth   - Remove stored credentials
 * GET    /user/shapes/auth/status - Check credential status
 *
 * Security:
 * - Session cookies are encrypted with AES-256-GCM (same as API keys)
 * - Never logs or returns actual cookie values
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  encryptApiKey,
  UserService,
  type PrismaClient,
  generateUserCredentialUuid,
  CREDENTIAL_SERVICES,
  CREDENTIAL_TYPES,
  SHAPES_SESSION_COOKIE_NAME,
} from '@tzurot/common-types';
import { requireUserAuth, requireProvisionedUser } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest, ProvisionedRequest } from '../../../types.js';

const logger = createLogger('shapes-auth');

const SHAPES_CREDENTIAL_WHERE = {
  service: CREDENTIAL_SERVICES.SHAPES_INC,
  credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
} as const;

function createStoreHandler(prisma: PrismaClient, userService: UserService) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const { sessionCookie } = req.body as { sessionCookie?: string };

    if (
      sessionCookie === undefined ||
      typeof sessionCookie !== 'string' ||
      sessionCookie.trim().length === 0
    ) {
      return sendError(res, ErrorResponses.validationError('sessionCookie is required'));
    }

    // Bot-client's auth modal normalizes input to `name=value` form via
    // parseShapesSessionCookieInput before POSTing here. We accept only that
    // strict shape: the string must start with the expected cookie name and
    // have a non-empty value following the `=`.
    const expectedPrefix = `${SHAPES_SESSION_COOKIE_NAME}=`;
    if (
      !sessionCookie.startsWith(expectedPrefix) ||
      sessionCookie.length <= expectedPrefix.length
    ) {
      return sendError(
        res,
        ErrorResponses.validationError(
          `Session cookie must be in the form '${SHAPES_SESSION_COOKIE_NAME}=<value>'`
        )
      );
    }

    const userId = await resolveProvisionedUserId(req, userService);

    const encrypted = encryptApiKey(sessionCookie);
    const credentialId = generateUserCredentialUuid(
      userId,
      CREDENTIAL_SERVICES.SHAPES_INC,
      CREDENTIAL_TYPES.SESSION_COOKIE
    );

    await prisma.userCredential.upsert({
      where: {
        userId_service_credentialType: { userId, ...SHAPES_CREDENTIAL_WHERE },
      },
      update: {
        iv: encrypted.iv,
        content: encrypted.content,
        tag: encrypted.tag,
      },
      create: {
        id: credentialId,
        userId,
        ...SHAPES_CREDENTIAL_WHERE,
        iv: encrypted.iv,
        content: encrypted.content,
        tag: encrypted.tag,
      },
    });

    logger.info({ discordUserId }, 'Session cookie stored');
    sendCustomSuccess(res, { success: true, timestamp: new Date().toISOString() }, StatusCodes.OK);
  };
}

function createDeleteHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.notFound('Shapes.inc credentials'));
    }

    const existing = await prisma.userCredential.findFirst({
      where: { userId: user.id, ...SHAPES_CREDENTIAL_WHERE },
    });

    if (existing === null) {
      return sendError(res, ErrorResponses.notFound('Shapes.inc credentials'));
    }

    await prisma.userCredential.delete({ where: { id: existing.id } });

    logger.info({ discordUserId }, 'Credentials removed');
    sendCustomSuccess(res, {
      success: true,
      message: 'Shapes.inc credentials removed',
      timestamp: new Date().toISOString(),
    });
  };
}

function createStatusHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (user === null) {
      sendCustomSuccess(res, { hasCredentials: false, service: CREDENTIAL_SERVICES.SHAPES_INC });
      return;
    }

    const credential = await prisma.userCredential.findFirst({
      where: { userId: user.id, ...SHAPES_CREDENTIAL_WHERE },
      select: { createdAt: true, lastUsedAt: true, expiresAt: true },
    });

    if (credential === null) {
      sendCustomSuccess(res, { hasCredentials: false, service: CREDENTIAL_SERVICES.SHAPES_INC });
      return;
    }

    sendCustomSuccess(res, {
      hasCredentials: true,
      service: CREDENTIAL_SERVICES.SHAPES_INC,
      storedAt: credential.createdAt.toISOString(),
      lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
      expiresAt: credential.expiresAt?.toISOString() ?? null,
    });
  };
}

export function createShapesAuthRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const userService = new UserService(prisma);

  router.post(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createStoreHandler(prisma, userService))
  );
  router.delete(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createDeleteHandler(prisma))
  );
  router.get(
    '/status',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createStatusHandler(prisma))
  );

  return router;
}
