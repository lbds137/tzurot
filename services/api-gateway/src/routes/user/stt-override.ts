/**
 * User STT Override Routes
 *
 * Set/clear STT provider overrides for personalities, plus user global default
 * STT provider. Mirrors `tts-override.ts` shape; differences are scoped to
 * the value type (string enum `SttProvider` vs UUID config-row reference).
 *
 * Endpoints (route order matters — `/default` MUST be registered before
 * `/:personalityId` or Express matches `default` as a personality param):
 *   GET    /user/stt-override                  — list per-personality + filter
 *   PUT    /user/stt-override                  — set per-personality (Layer 1)
 *   GET    /user/stt-override/default          — get user-default STT
 *   PUT    /user/stt-override/default          — set user-default STT (Layer 2)
 *   DELETE /user/stt-override/default          — clear user-default STT
 *   DELETE /user/stt-override/:personalityId   — clear per-personality
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  generateUserPersonalityConfigUuid,
  type PrismaClient,
  type SttResolverCacheInvalidationService,
  type SttOverrideSummary,
  type UserDefaultSttProvider,
  SetSttOverrideSchema,
  SetSttDefaultProviderSchema,
  isSttProvider,
} from '@tzurot/common-types';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { tryInvalidateCache } from '../../utils/configOverrideHelpers.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { getParam } from '../../utils/requestParams.js';
import type { ProvisionedRequest } from '../../types.js';

const logger = createLogger('user-stt-override');

// eslint-disable-next-line max-lines-per-function -- Route factory with multiple endpoints (mirrors tts-override.ts shape)
export function createSttOverrideRoutes(
  prisma: PrismaClient,
  sttCacheInvalidation?: SttResolverCacheInvalidationService
): Router {
  const router = Router();

  /** GET /user/stt-override — list per-personality STT overrides */
  router.get(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;
      const userId = resolveProvisionedUserId(req);

      const overrides = await prisma.userPersonalityConfig.findMany({
        where: {
          userId,
          sttProviderId: { not: null },
        },
        select: {
          personalityId: true,
          personality: { select: { name: true } },
          sttProviderId: true,
        },
        take: 100,
      });

      // Defensive narrowing: the DB column has no CHECK constraint, so legacy
      // rows or out-of-band SQL inserts could carry an unrecognized provider
      // string. Mirror SttResolver.narrow() — surface unknown values as null
      // rather than passing them through to the client.
      const result: SttOverrideSummary[] = overrides.map(o => ({
        personalityId: o.personalityId,
        personalityName: o.personality.name,
        providerId:
          o.sttProviderId !== null && isSttProvider(o.sttProviderId) ? o.sttProviderId : null,
      }));

      logger.info({ discordUserId, count: result.length }, 'Listed STT overrides');
      sendCustomSuccess(res, { overrides: result }, StatusCodes.OK);
    })
  );

  /** PUT /user/stt-override — set per-personality STT override */
  router.put(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;

      const parseResult = SetSttOverrideSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }
      const { personalityId, providerId } = parseResult.data;

      const userId = resolveProvisionedUserId(req);

      const personality = await prisma.personality.findFirst({
        where: { id: personalityId },
        select: { id: true, name: true },
      });
      if (personality === null) {
        return sendError(res, ErrorResponses.notFound('Personality'));
      }

      const override = await prisma.userPersonalityConfig.upsert({
        where: { userId_personalityId: { userId, personalityId } },
        create: {
          id: generateUserPersonalityConfigUuid(userId, personalityId),
          userId,
          personalityId,
          sttProviderId: providerId,
        },
        update: { sttProviderId: providerId },
        select: {
          personalityId: true,
          personality: { select: { name: true } },
          sttProviderId: true,
        },
      });

      const result: SttOverrideSummary = {
        personalityId: override.personalityId,
        personalityName: override.personality.name,
        providerId:
          override.sttProviderId !== null && isSttProvider(override.sttProviderId)
            ? override.sttProviderId
            : null,
      };

      logger.info(
        { discordUserId, personalityId, personalityName: personality.name, providerId },
        'Set STT override'
      );

      await tryInvalidateCache(
        sttCacheInvalidation?.invalidateUserStt.bind(sttCacheInvalidation, discordUserId),
        { discordUserId }
      );

      sendCustomSuccess(res, { override: result }, StatusCodes.OK);
    })
  );

  // ============================================
  // User-default STT routes — MUST come BEFORE /:personalityId
  // ============================================

  router.get(
    '/default',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;
      const userId = resolveProvisionedUserId(req);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { defaultSttProviderId: true },
      });

      // Defensive narrowing — see GET / handler comment.
      const raw = user?.defaultSttProviderId ?? null;
      const result: UserDefaultSttProvider = {
        providerId: raw !== null && isSttProvider(raw) ? raw : null,
      };

      logger.info({ discordUserId, providerId: result.providerId }, 'Got default STT provider');
      sendCustomSuccess(res, { default: result }, StatusCodes.OK);
    })
  );

  router.put(
    '/default',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
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

      logger.info({ discordUserId, providerId }, 'Set default STT provider');

      await tryInvalidateCache(
        sttCacheInvalidation?.invalidateUserStt.bind(sttCacheInvalidation, discordUserId),
        { discordUserId }
      );

      sendCustomSuccess(res, { default: result }, StatusCodes.OK);
    })
  );

  router.delete(
    '/default',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;
      const userId = resolveProvisionedUserId(req);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { defaultSttProviderId: true },
      });
      if (user === null) {
        return sendError(res, ErrorResponses.notFound('User'));
      }

      // Idempotent: no default set → wasSet:false success
      if (user.defaultSttProviderId === null) {
        logger.info(
          { discordUserId, hadDefault: false },
          'Clear called but no default STT was set (idempotent success)'
        );
        return sendCustomSuccess(res, { deleted: true, wasSet: false }, StatusCodes.OK);
      }

      await prisma.user.update({
        where: { id: userId },
        data: { defaultSttProviderId: null },
      });

      logger.info({ discordUserId }, 'Cleared default STT provider');

      await tryInvalidateCache(
        sttCacheInvalidation?.invalidateUserStt.bind(sttCacheInvalidation, discordUserId),
        { discordUserId }
      );

      sendCustomSuccess(res, { deleted: true, wasSet: true }, StatusCodes.OK);
    })
  );

  // ============================================
  // Personality-specific clear — MUST come AFTER /default
  // ============================================

  router.delete(
    '/:personalityId',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;
      const personalityId = getParam(req.params.personalityId);
      const userId = resolveProvisionedUserId(req);

      const override = await prisma.userPersonalityConfig.findFirst({
        where: { userId, personalityId },
        select: { id: true, sttProviderId: true, personality: { select: { name: true } } },
      });

      if (override?.sttProviderId === null || override?.sttProviderId === undefined) {
        logger.info(
          { discordUserId, personalityId, hadOverride: false },
          'Clear called but no STT override was set (idempotent success)'
        );
        return sendCustomSuccess(res, { deleted: true, wasSet: false }, StatusCodes.OK);
      }

      await prisma.userPersonalityConfig.update({
        where: { id: override.id },
        data: { sttProviderId: null },
      });

      logger.info(
        { discordUserId, personalityId, personalityName: override.personality.name },
        'Cleared STT override'
      );

      await tryInvalidateCache(
        sttCacheInvalidation?.invalidateUserStt.bind(sttCacheInvalidation, discordUserId),
        { discordUserId }
      );

      sendCustomSuccess(res, { deleted: true, wasSet: true }, StatusCodes.OK);
    })
  );

  return router;
}
