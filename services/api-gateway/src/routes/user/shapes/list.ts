/**
 * Shapes.inc List Route
 *
 * GET /user/shapes/list - Fetch owned shapes from shapes.inc
 *
 * Proxies the user's request to shapes.inc /api/shapes?category=self
 * using their stored session cookie.
 */

import { Router, type Response } from 'express';
import {
  createLogger,
  decryptApiKey,
  type PrismaClient,
  CREDENTIAL_SERVICES,
  CREDENTIAL_TYPES,
  SHAPES_BASE_URL,
  SHAPES_USER_AGENT,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('shapes-list');

const REQUEST_TIMEOUT_MS = 15_000;

interface ShapesListItem {
  id: string;
  name: string;
  username: string;
  avatar: string;
  created_ts?: number;
}

function createListHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Look up user and credential
    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.unauthorized('No shapes.inc credentials found'));
    }

    const credential = await prisma.userCredential.findFirst({
      where: {
        userId: user.id,
        service: CREDENTIAL_SERVICES.SHAPES_INC,
        credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
      },
    });

    if (credential === null) {
      return sendError(res, ErrorResponses.unauthorized('No shapes.inc credentials found'));
    }

    // Decrypt session cookie
    const sessionCookie = decryptApiKey({
      iv: credential.iv,
      content: credential.content,
      tag: credential.tag,
    });

    // Fetch owned shapes from shapes.inc
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${SHAPES_BASE_URL}/api/shapes?category=self`, {
        headers: {
          Cookie: sessionCookie,
          'User-Agent': SHAPES_USER_AGENT,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      // Detect redirect to login page (shapes.inc may redirect instead of 401)
      const finalUrl = response.url;
      const wasRedirected = finalUrl !== `${SHAPES_BASE_URL}/api/shapes?category=self`;

      if (!response.ok || wasRedirected) {
        const bodyText = await response.text().catch(() => '(unreadable)');
        logger.warn(
          {
            status: response.status,
            finalUrl,
            wasRedirected,
            bodyPreview: bodyText.slice(0, 200),
            discordUserId,
          },
          '[Shapes] shapes.inc API call failed'
        );

        if (response.status === 401 || response.status === 403 || wasRedirected) {
          return sendError(
            res,
            ErrorResponses.unauthorized(
              'Session cookie expired or invalid. Re-authenticate with /shapes auth.'
            )
          );
        }
        return sendError(
          res,
          ErrorResponses.serviceUnavailable(`shapes.inc returned ${String(response.status)}`)
        );
      }

      const shapes = (await response.json()) as ShapesListItem[];

      // Update lastUsedAt
      await prisma.userCredential.updateMany({
        where: {
          userId: user.id,
          service: CREDENTIAL_SERVICES.SHAPES_INC,
          credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
        },
        data: { lastUsedAt: new Date() },
      });

      logger.info({ discordUserId, shapesCount: shapes.length }, '[Shapes] Listed owned shapes');

      sendCustomSuccess(res, {
        shapes: shapes.map(s => ({
          id: s.id,
          name: s.name,
          username: s.username,
          avatar: s.avatar,
          createdAt:
            s.created_ts !== undefined && s.created_ts !== null
              ? new Date(s.created_ts * 1000).toISOString()
              : null,
        })),
        total: shapes.length,
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function createShapesListRoutes(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', requireUserAuth(), asyncHandler(createListHandler(prisma)));

  return router;
}
