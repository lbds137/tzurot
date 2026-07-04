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

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { StoreShapesAuthInputSchema } from '@tzurot/common-types/schemas/api/shapes';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  CREDENTIAL_SERVICES,
  CREDENTIAL_TYPES,
  SHAPES_SESSION_COOKIE_NAME,
  SHAPES_TOKEN_MIN_LENGTH,
  SHAPES_TOKEN_MAX_LENGTH,
  isPlausibleShapesTokenValue,
} from '@tzurot/common-types/types/shapes-import';
import { generateUserCredentialUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { encryptApiKey } from '@tzurot/common-types/utils/encryption';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { parseBodyOrSendError } from '../../../utils/configRouteHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { probeShapesSession } from '../../../services/ShapesPreflight.js';
import type { ProvisionedRequest } from '../../../types.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('shapes-auth');

const SHAPES_CREDENTIAL_WHERE = {
  service: CREDENTIAL_SERVICES.SHAPES_INC,
  credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
} as const;

function createStoreHandler(prisma: PrismaClient) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parsed = parseBodyOrSendError(res, StoreShapesAuthInputSchema, req.body);
    if (parsed === null) {
      return;
    }
    const { sessionCookie } = parsed;

    // Bot-client's auth modal normalizes input to `name=value` form via
    // parseShapesSessionCookieInput before POSTing here. We accept only that
    // strict shape: the string must start with the expected cookie name, and
    // the value portion must pass the same shape gate the parser applies.
    // Defense-in-depth against direct API callers that skip the bot-client
    // modal and would otherwise persist a 1-char or obviously-malformed
    // value that shapes.inc will reject on the next request anyway.
    const expectedPrefix = `${SHAPES_SESSION_COOKIE_NAME}=`;
    if (!sessionCookie.startsWith(expectedPrefix)) {
      return sendError(
        res,
        ErrorResponses.validationError(
          `Session cookie must be in the form '${SHAPES_SESSION_COOKIE_NAME}=<value>'`
        )
      );
    }
    const tokenValue = sessionCookie.substring(expectedPrefix.length);
    if (!isPlausibleShapesTokenValue(tokenValue)) {
      return sendError(
        res,
        ErrorResponses.validationError(
          `Session cookie value must be ${SHAPES_TOKEN_MIN_LENGTH}-${SHAPES_TOKEN_MAX_LENGTH} characters and not contain whitespace or cookie separators (;, comma, quote, backslash)`
        )
      );
    }

    // Preflight the cookie against shapes.inc before persisting. Catches
    // already-expired cookies at submit time rather than on the user's first
    // `/shapes import` attempt minutes later. Transient upstream failures
    // (5xx, network, timeout) produce `inconclusive` and we proceed anyway —
    // a shapes.inc outage must not block users from saving valid credentials.
    const preflight = await probeShapesSession(sessionCookie);
    if (preflight === 'invalid') {
      logger.info({ discordUserId }, 'Preflight rejected cookie; not persisting');
      return sendError(
        res,
        ErrorResponses.validationError(
          'shapes.inc rejected this session cookie. It may be expired or from the wrong domain — harvest a fresh cookie from https://shapes.inc/dashboard and try again.'
        )
      );
    }
    if (preflight === 'inconclusive') {
      logger.warn({ discordUserId }, 'Preflight inconclusive; proceeding with persistence');
    }

    const userId = resolveProvisionedUserId(req);

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
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = resolveProvisionedUserId(req);

    const existing = await prisma.userCredential.findFirst({
      where: { userId, ...SHAPES_CREDENTIAL_WHERE },
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
  return async (req: ProvisionedRequest, res: Response) => {
    const userId = resolveProvisionedUserId(req);

    const credential = await prisma.userCredential.findFirst({
      where: { userId, ...SHAPES_CREDENTIAL_WHERE },
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

// ===== Handler factories ===================================================

/** POST /api/user/shapes/auth — store shapes.inc session cookie. */
export const handleStoreShapesAuth = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createStoreHandler(deps.prisma));

/** DELETE /api/user/shapes/auth — remove shapes.inc credentials. */
export const handleDeleteShapesAuth = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createDeleteHandler(deps.prisma));

/** GET /api/user/shapes/auth/status — check whether the user has stored credentials. */
export const handleGetShapesAuthStatus = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createStatusHandler(deps.prisma));
