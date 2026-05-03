/**
 * User TTS Override Routes
 * Set/reset TTS config overrides for personalities, plus user global default.
 *
 * Endpoints:
 * - GET    /user/tts-override              - List all user's TTS overrides
 * - PUT    /user/tts-override              - Set override for a personality
 * - GET    /user/tts-override/default      - Get user's global default TTS config
 * - PUT    /user/tts-override/default      - Set user's global default TTS config
 * - DELETE /user/tts-override/default      - Clear user's global default TTS config
 * - DELETE /user/tts-override/:personalityId - Remove override (MUST be after /default)
 *
 * Mirrors `routes/user/model-override.ts` exactly — same shape, same
 * idempotency contract — but acts on `UserPersonalityConfig.ttsConfigId`
 * and `User.defaultTtsConfigId` instead of the LLM equivalents.
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  generateUserPersonalityConfigUuid,
  type PrismaClient,
  type TtsOverrideSummary,
  type TtsConfigCacheInvalidationService,
  type UserDefaultTtsConfig,
  SetTtsOverrideSchema,
  SetTtsDefaultConfigSchema,
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

const logger = createLogger('user-tts-override');

/**
 * Verify that the given TTS config exists and the user can access it
 * (global or owned). Returns the config if accessible, null otherwise.
 */
async function verifyTtsConfigAccess(
  prisma: PrismaClient,
  configId: string,
  userId: string
): Promise<{ id: string; name: string } | null> {
  return prisma.ttsConfig.findFirst({
    where: {
      id: configId,
      OR: [{ isGlobal: true }, { ownerId: userId }],
    },
    select: { id: true, name: true },
  });
}

// eslint-disable-next-line max-lines-per-function -- Route factory with multiple endpoints (mirrors model-override.ts shape)
export function createTtsOverrideRoutes(
  prisma: PrismaClient,
  ttsConfigCacheInvalidation?: TtsConfigCacheInvalidationService
): Router {
  const router = Router();

  /** GET /user/tts-override — list all user TTS overrides */
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
          ttsConfigId: { not: null },
        },
        select: {
          personalityId: true,
          personality: { select: { name: true } },
          ttsConfigId: true,
          ttsConfig: { select: { name: true } },
        },
        take: 100,
      });

      const result: TtsOverrideSummary[] = overrides.map(o => ({
        personalityId: o.personalityId,
        personalityName: o.personality.name,
        configId: o.ttsConfigId,
        configName: o.ttsConfig?.name ?? null,
      }));

      logger.info({ discordUserId, count: result.length }, 'Listed TTS overrides');
      sendCustomSuccess(res, { overrides: result }, StatusCodes.OK);
    })
  );

  /** PUT /user/tts-override — set TTS override for a personality */
  router.put(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;

      const parseResult = SetTtsOverrideSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }
      const { personalityId, configId } = parseResult.data;

      const userId = resolveProvisionedUserId(req);

      const personality = await prisma.personality.findFirst({
        where: { id: personalityId },
        select: { id: true, name: true },
      });
      if (personality === null) {
        return sendError(res, ErrorResponses.notFound('Personality'));
      }

      const ttsConfig = await verifyTtsConfigAccess(prisma, configId, userId);
      if (ttsConfig === null) {
        return sendError(res, ErrorResponses.notFound('TtsConfig'));
      }

      const override = await prisma.userPersonalityConfig.upsert({
        where: {
          userId_personalityId: { userId, personalityId },
        },
        create: {
          id: generateUserPersonalityConfigUuid(userId, personalityId),
          userId,
          personalityId,
          ttsConfigId: configId,
        },
        update: {
          ttsConfigId: configId,
        },
        select: {
          personalityId: true,
          personality: { select: { name: true } },
          ttsConfigId: true,
          ttsConfig: { select: { name: true } },
        },
      });

      const result: TtsOverrideSummary = {
        personalityId: override.personalityId,
        personalityName: override.personality.name,
        configId: override.ttsConfigId,
        configName: override.ttsConfig?.name ?? null,
      };

      logger.info(
        {
          discordUserId,
          personalityId,
          personalityName: personality.name,
          configId,
          configName: ttsConfig.name,
        },
        'Set TTS override'
      );

      // Invalidate per-user TTS cache so the dispatcher picks up the change
      await tryInvalidateCache(
        ttsConfigCacheInvalidation?.invalidateUserTtsConfig.bind(
          ttsConfigCacheInvalidation,
          discordUserId
        ),
        { discordUserId }
      );

      sendCustomSuccess(res, { override: result }, StatusCodes.OK);
    })
  );

  // ============================================
  // User Global Default TTS Config Routes
  // NOTE: These MUST be defined BEFORE /:personalityId to avoid Express
  // matching "default" as a personalityId parameter.
  // ============================================

  /** GET /user/tts-override/default — get user's global default TTS config */
  router.get(
    '/default',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;
      const userId = resolveProvisionedUserId(req);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          defaultTtsConfigId: true,
          defaultTtsConfig: { select: { name: true } },
        },
      });

      const result: UserDefaultTtsConfig = {
        configId: user?.defaultTtsConfigId ?? null,
        configName: user?.defaultTtsConfig?.name ?? null,
      };

      logger.info({ discordUserId, configId: result.configId }, 'Got default TTS config');
      sendCustomSuccess(res, { default: result }, StatusCodes.OK);
    })
  );

  /** PUT /user/tts-override/default — set user's global default TTS config */
  router.put(
    '/default',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;

      const parseResult = SetTtsDefaultConfigSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }
      const { configId } = parseResult.data;
      const userId = resolveProvisionedUserId(req);

      const ttsConfig = await verifyTtsConfigAccess(prisma, configId, userId);
      if (ttsConfig === null) {
        return sendError(res, ErrorResponses.notFound('TtsConfig'));
      }

      await prisma.user.update({
        where: { id: userId },
        data: { defaultTtsConfigId: configId },
      });

      const result: UserDefaultTtsConfig = {
        configId: ttsConfig.id,
        configName: ttsConfig.name,
      };

      logger.info(
        { discordUserId, configId, configName: ttsConfig.name },
        'Set default TTS config'
      );

      await tryInvalidateCache(
        ttsConfigCacheInvalidation?.invalidateUserTtsConfig.bind(
          ttsConfigCacheInvalidation,
          discordUserId
        ),
        { discordUserId }
      );

      sendCustomSuccess(res, { default: result }, StatusCodes.OK);
    })
  );

  /** DELETE /user/tts-override/default — clear user's global default TTS config */
  router.delete(
    '/default',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;
      const userId = resolveProvisionedUserId(req);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { defaultTtsConfigId: true },
      });
      if (user === null) {
        return sendError(res, ErrorResponses.notFound('User'));
      }

      // Idempotent: no default set → success with wasSet: false
      if (user.defaultTtsConfigId === null) {
        logger.info(
          { discordUserId, hadDefault: false },
          'Clear called but no default TTS was set (idempotent success)'
        );
        return sendCustomSuccess(res, { deleted: true, wasSet: false }, StatusCodes.OK);
      }

      await prisma.user.update({
        where: { id: userId },
        data: { defaultTtsConfigId: null },
      });

      logger.info({ discordUserId }, 'Cleared default TTS config');

      await tryInvalidateCache(
        ttsConfigCacheInvalidation?.invalidateUserTtsConfig.bind(
          ttsConfigCacheInvalidation,
          discordUserId
        ),
        { discordUserId }
      );

      // Symmetric with the no-op branch above (which returns wasSet: false)
      // and with DELETE /:personalityId — explicit `wasSet: true` lets a
      // future caller distinguish "actually cleared" from "already empty"
      // via a single field check.
      sendCustomSuccess(res, { deleted: true, wasSet: true }, StatusCodes.OK);
    })
  );

  // ============================================
  // Personality-specific override route — MUST come AFTER /default
  // ============================================

  /** DELETE /user/tts-override/:personalityId — remove TTS override for a personality */
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
        select: { id: true, ttsConfigId: true, personality: { select: { name: true } } },
      });

      // Idempotent: no override or already null
      if (override?.ttsConfigId === null || override?.ttsConfigId === undefined) {
        logger.info(
          { discordUserId, personalityId, hadOverride: false },
          'Reset called but no TTS override was set (idempotent success)'
        );
        return sendCustomSuccess(res, { deleted: true, wasSet: false }, StatusCodes.OK);
      }

      await prisma.userPersonalityConfig.update({
        where: { id: override.id },
        data: { ttsConfigId: null },
      });

      logger.info(
        { discordUserId, personalityId, personalityName: override.personality.name },
        'Removed TTS override'
      );

      await tryInvalidateCache(
        ttsConfigCacheInvalidation?.invalidateUserTtsConfig.bind(
          ttsConfigCacheInvalidation,
          discordUserId
        ),
        { discordUserId }
      );

      sendCustomSuccess(res, { deleted: true, wasSet: true }, StatusCodes.OK);
    })
  );

  return router;
}
