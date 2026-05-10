/**
 * User Voice Provider Routes
 *
 * Read/write the foundational `User.defaultProvider` field. Set by
 * `/voice provider set <id>`; read by SttResolver as Layer 4 (admin-default)
 * of the cascade. Surgical TTS/STT overrides layer above this baseline.
 *
 * Endpoints:
 *   GET    /user/voice-provider — read User.defaultProvider
 *   PUT    /user/voice-provider — set
 *   DELETE /user/voice-provider — clear
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  type SttResolverCacheInvalidationService,
  type GetVoiceProviderResponse,
  type SetVoiceProviderResponse,
  SetVoiceProviderSchema,
  isSttProvider,
} from '@tzurot/common-types';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { tryInvalidateCache } from '../../utils/configOverrideHelpers.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { ProvisionedRequest } from '../../types.js';

const logger = createLogger('user-voice-provider');

export function createVoiceProviderRoutes(
  prisma: PrismaClient,
  sttCacheInvalidation?: SttResolverCacheInvalidationService
): Router {
  const router = Router();

  router.get(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;
      const userId = resolveProvisionedUserId(req);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { defaultProvider: true },
      });

      // Defensive narrowing: DB column has no CHECK constraint, so legacy or
      // out-of-band rows could carry an unrecognized provider string. Mirror
      // SttResolver.narrow() — surface unknown values as null.
      const raw = user?.defaultProvider ?? null;
      const result: GetVoiceProviderResponse = {
        providerId: raw !== null && isSttProvider(raw) ? raw : null,
      };

      logger.info({ discordUserId, providerId: result.providerId }, 'Got voice provider default');
      sendCustomSuccess(res, result, StatusCodes.OK);
    })
  );

  router.put(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;

      const parseResult = SetVoiceProviderSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }
      const { providerId } = parseResult.data;
      const userId = resolveProvisionedUserId(req);

      await prisma.user.update({
        where: { id: userId },
        data: { defaultProvider: providerId },
      });

      const result: SetVoiceProviderResponse = { providerId };

      logger.info({ discordUserId, providerId }, 'Set voice provider default');

      await tryInvalidateCache(
        sttCacheInvalidation?.invalidateUserStt.bind(sttCacheInvalidation, discordUserId),
        { discordUserId }
      );

      sendCustomSuccess(res, result, StatusCodes.OK);
    })
  );

  router.delete(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;
      const userId = resolveProvisionedUserId(req);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { defaultProvider: true },
      });
      if (user === null) {
        return sendError(res, ErrorResponses.notFound('User'));
      }

      if (user.defaultProvider === null) {
        logger.info(
          { discordUserId, hadDefault: false },
          'Clear called but no voice provider default was set (idempotent success)'
        );
        return sendCustomSuccess(res, { deleted: true, wasSet: false }, StatusCodes.OK);
      }

      await prisma.user.update({
        where: { id: userId },
        data: { defaultProvider: null },
      });

      logger.info({ discordUserId }, 'Cleared voice provider default');

      await tryInvalidateCache(
        sttCacheInvalidation?.invalidateUserStt.bind(sttCacheInvalidation, discordUserId),
        { discordUserId }
      );

      sendCustomSuccess(res, { deleted: true, wasSet: true }, StatusCodes.OK);
    })
  );

  return router;
}
