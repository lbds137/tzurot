/**
 * User STT Override Routes
 *
 * The user-level STT preference. STT is speaker-bound (your voice doesn't
 * change per character) so there's no per-personality dimension — one
 * preference per user. When unset, transcription derives from the user's
 * default TTS provider (Mistral / ElevenLabs) or falls back to the
 * self-hosted voice-engine.
 *
 * Endpoints:
 *   GET    /user/stt-override — read User.defaultSttProviderId
 *   PUT    /user/stt-override — set
 *   DELETE /user/stt-override — clear
 */

import { Router, type Response, type RequestHandler } from 'express';
import {
  type UserDefaultSttProvider,
  ClearSttDefaultProviderResponseSchema,
  SetSttDefaultProviderResponseSchema,
  SetSttDefaultProviderSchema,
} from '@tzurot/common-types/schemas/api/stt-override';
import { isSttProvider } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { tryInvalidateCache } from '../../utils/configOverrideHelpers.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendContractSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('user-stt-override');

/** GET /api/user/stt-override — read user's STT preference */
export const handleGetSttDefaultProvider = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = resolveProvisionedUserId(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { defaultSttProviderId: true },
    });

    // Defensive narrowing: DB column has no CHECK constraint, so legacy
    // rows or out-of-band SQL inserts could carry an unrecognized provider
    // string. Mirror SttResolver.narrow() — surface unknown values as null.
    const raw = user?.defaultSttProviderId ?? null;
    const result: UserDefaultSttProvider = {
      providerId: raw !== null && isSttProvider(raw) ? raw : null,
    };

    logger.info({ discordUserId, providerId: result.providerId }, 'Got STT preference');
    sendContractSuccess(res, SetSttDefaultProviderResponseSchema, { default: result });
  });
};

/** PUT /api/user/stt-override — set the user's STT preference */
export const handleSetSttDefaultProvider = (deps: RouteDeps): RequestHandler => {
  const { prisma, sttResolverCacheInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = SetSttDefaultProviderSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const { providerId } = parseResult.data;
    const userId = resolveProvisionedUserId(req);

    await prisma.user.update({
      where: { id: userId },
      data: { defaultSttProviderId: providerId },
    });

    const result: UserDefaultSttProvider = { providerId };

    logger.info({ discordUserId, providerId }, 'Set STT preference');

    await tryInvalidateCache(
      sttResolverCacheInvalidation?.invalidateUserStt.bind(
        sttResolverCacheInvalidation,
        discordUserId
      ),
      { discordUserId }
    );

    sendContractSuccess(res, SetSttDefaultProviderResponseSchema, { default: result });
  });
};

/** DELETE /api/user/stt-override — clear the user's STT preference */
export const handleClearSttDefaultProvider = (deps: RouteDeps): RequestHandler => {
  const { prisma, sttResolverCacheInvalidation } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = resolveProvisionedUserId(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { defaultSttProviderId: true },
    });
    if (user === null) {
      return sendError(res, ErrorResponses.notFound('User'));
    }

    if (user.defaultSttProviderId === null) {
      logger.info(
        { discordUserId, hadDefault: false },
        'Clear called but no STT preference was set (idempotent success)'
      );
      return sendContractSuccess(res, ClearSttDefaultProviderResponseSchema, {
        deleted: true,
        wasSet: false,
      });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { defaultSttProviderId: null },
    });

    logger.info({ discordUserId }, 'Cleared STT preference');

    await tryInvalidateCache(
      sttResolverCacheInvalidation?.invalidateUserStt.bind(
        sttResolverCacheInvalidation,
        discordUserId
      ),
      { discordUserId }
    );

    sendContractSuccess(res, ClearSttDefaultProviderResponseSchema, {
      deleted: true,
      wasSet: true,
    });
  });
};

export function createSttOverrideRoutes(deps: RouteDeps): Router {
  const router = Router();
  const requireProvisioned = requireProvisionedUser(deps.prisma);

  router.get('/', requireUserAuth(), requireProvisioned, handleGetSttDefaultProvider(deps));
  router.put('/', requireUserAuth(), requireProvisioned, handleSetSttDefaultProvider(deps));
  router.delete('/', requireUserAuth(), requireProvisioned, handleClearSttDefaultProvider(deps));

  return router;
}
