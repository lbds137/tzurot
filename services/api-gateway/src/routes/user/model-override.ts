/**
 * User Model Override Routes
 * Set/reset LLM config overrides for personalities
 *
 * Endpoints:
 * - GET /user/model-override - List all user's model overrides
 * - PUT /user/model-override - Set override for a personality
 * - GET /user/model-override/default - Get user's global default config
 * - PUT /user/model-override/default - Set user's global default config
 * - DELETE /user/model-override/default - Clear user's global default config
 * - DELETE /user/model-override/:personalityId - Remove override (MUST be after /default routes)
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  generateUserPersonalityConfigUuid,
  UserService,
  type PrismaClient,
  type ModelOverrideSummary,
  type LlmConfigCacheInvalidationService,
  type UserDefaultConfig,
  SetModelOverrideSchema,
  SetDefaultConfigSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { getParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-model-override');

/**
 * Verify that the given LLM config exists and the user can access it (global or owned).
 * Returns the config if accessible, null otherwise.
 */
async function verifyConfigAccess(
  prisma: PrismaClient,
  configId: string,
  userId: string
): Promise<{ id: string; name: string } | null> {
  return prisma.llmConfig.findFirst({
    where: {
      id: configId,
      OR: [{ isGlobal: true }, { ownerId: userId }],
    },
    select: { id: true, name: true },
  });
}

/**
 * Attempt to invalidate user LLM config cache. Logs errors but does not throw.
 */
async function tryInvalidateUserLlmConfigCache(
  service: LlmConfigCacheInvalidationService | undefined,
  discordUserId: string
): Promise<void> {
  if (!service) {
    return;
  }

  try {
    await service.invalidateUserLlmConfig(discordUserId);
    logger.debug({ discordUserId }, '[ModelDefault] Invalidated user LLM config cache');
  } catch (err) {
    // Log but don't fail the request - cache will expire naturally
    logger.error({ err, discordUserId }, '[ModelDefault] Failed to invalidate cache');
  }
}

// eslint-disable-next-line max-lines-per-function -- Route factory with multiple endpoints
export function createModelOverrideRoutes(
  prisma: PrismaClient,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService
): Router {
  const router = Router();
  const userService = new UserService(prisma);

  /**
   * GET /user/model-override
   * List all model overrides for the user
   */
  router.get(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      // Get user ID
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      if (user === null) {
        return sendCustomSuccess(res, { overrides: [] }, StatusCodes.OK);
      }

      // Get all overrides with personality and config names
      const overrides = await prisma.userPersonalityConfig.findMany({
        where: {
          userId: user.id,
          llmConfigId: { not: null },
        },
        select: {
          personalityId: true,
          personality: { select: { name: true } },
          llmConfigId: true,
          llmConfig: { select: { name: true } },
        },
        take: 100,
      });

      const result: ModelOverrideSummary[] = overrides.map(o => ({
        personalityId: o.personalityId,
        personalityName: o.personality.name,
        configId: o.llmConfigId,
        configName: o.llmConfig?.name ?? null,
      }));

      logger.info({ discordUserId, count: result.length }, '[ModelOverride] Listed overrides');

      sendCustomSuccess(res, { overrides: result }, StatusCodes.OK);
    })
  );

  /**
   * PUT /user/model-override
   * Set model override for a personality
   */
  router.put(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      // Validate request body with Zod
      const parseResult = SetModelOverrideSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }

      const { personalityId, configId } = parseResult.data;

      // Get or create user via centralized UserService
      const userId = await userService.getOrCreateUser(discordUserId, discordUserId);
      if (userId === null) {
        // Should not happen for slash commands (bots can't use them)
        return sendError(res, ErrorResponses.validationError('Cannot create user for bot'));
      }

      // Verify personality exists
      const personality = await prisma.personality.findFirst({
        where: { id: personalityId },
        select: { id: true, name: true },
      });

      if (personality === null) {
        return sendError(res, ErrorResponses.notFound('Personality not found'));
      }

      // Verify config exists and user can access it
      const llmConfig = await verifyConfigAccess(prisma, configId, userId);
      if (llmConfig === null) {
        return sendError(res, ErrorResponses.notFound('Config not found or not accessible'));
      }

      // Upsert the UserPersonalityConfig (use deterministic UUID for cross-env sync)
      const override = await prisma.userPersonalityConfig.upsert({
        where: {
          userId_personalityId: {
            userId,
            personalityId,
          },
        },
        create: {
          id: generateUserPersonalityConfigUuid(userId, personalityId),
          userId,
          personalityId,
          llmConfigId: configId,
        },
        update: {
          llmConfigId: configId,
        },
        select: {
          personalityId: true,
          personality: { select: { name: true } },
          llmConfigId: true,
          llmConfig: { select: { name: true } },
        },
      });

      const result: ModelOverrideSummary = {
        personalityId: override.personalityId,
        personalityName: override.personality.name,
        configId: override.llmConfigId,
        configName: override.llmConfig?.name ?? null,
      };

      logger.info(
        {
          discordUserId,
          personalityId,
          personalityName: personality.name,
          configId,
          configName: llmConfig.name,
        },
        '[ModelOverride] Set override'
      );

      sendCustomSuccess(res, { override: result }, StatusCodes.OK);
    })
  );

  // ============================================
  // User Global Default Config Routes
  // NOTE: These MUST be defined BEFORE /:personalityId to avoid
  // Express matching "default" as a personalityId parameter
  // ============================================

  /**
   * GET /user/model-override/default
   * Get user's global default LLM config
   */
  router.get(
    '/default',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: {
          defaultLlmConfigId: true,
          defaultLlmConfig: { select: { name: true } },
        },
      });

      const result: UserDefaultConfig = {
        configId: user?.defaultLlmConfigId ?? null,
        configName: user?.defaultLlmConfig?.name ?? null,
      };

      logger.info(
        { discordUserId, configId: result.configId },
        '[ModelDefault] Got default config'
      );

      sendCustomSuccess(res, { default: result }, StatusCodes.OK);
    })
  );

  /**
   * PUT /user/model-default
   * Set user's global default LLM config
   */
  router.put(
    '/default',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      // Validate request body with Zod
      const parseResult = SetDefaultConfigSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }

      const { configId } = parseResult.data;

      // Get or create user via centralized UserService
      const userId = await userService.getOrCreateUser(discordUserId, discordUserId);
      if (userId === null) {
        // Should not happen for slash commands (bots can't use them)
        return sendError(res, ErrorResponses.validationError('Cannot create user for bot'));
      }

      // Verify config exists and user can access it (global or owned)
      const llmConfig = await verifyConfigAccess(prisma, configId, userId);
      if (llmConfig === null) {
        return sendError(res, ErrorResponses.notFound('Config not found or not accessible'));
      }

      // Update user's default config
      await prisma.user.update({
        where: { id: userId },
        data: { defaultLlmConfigId: configId },
      });

      const result: UserDefaultConfig = {
        configId: llmConfig.id,
        configName: llmConfig.name,
      };

      logger.info(
        { discordUserId, configId, configName: llmConfig.name },
        '[ModelDefault] Set default config'
      );

      // Invalidate user's LLM config cache so ai-worker picks up the change
      await tryInvalidateUserLlmConfigCache(llmConfigCacheInvalidation, discordUserId);

      sendCustomSuccess(res, { default: result }, StatusCodes.OK);
    })
  );

  /**
   * DELETE /user/model-default
   * Clear user's global default LLM config
   */
  router.delete(
    '/default',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true, defaultLlmConfigId: true },
      });

      if (user === null) {
        return sendError(res, ErrorResponses.notFound('User not found'));
      }

      // Idempotent: if no default config is set, return success with wasSet: false
      if (user.defaultLlmConfigId === null) {
        logger.info(
          { discordUserId, hadDefault: false },
          '[ModelDefault] Clear called but no default was set (idempotent success)'
        );
        return sendCustomSuccess(res, { deleted: true, wasSet: false }, StatusCodes.OK);
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { defaultLlmConfigId: null },
      });

      logger.info({ discordUserId }, '[ModelDefault] Cleared default config');

      // Invalidate user's LLM config cache so ai-worker picks up the change
      await tryInvalidateUserLlmConfigCache(llmConfigCacheInvalidation, discordUserId);

      sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
    })
  );

  // ============================================
  // Personality-specific Override Route
  // NOTE: This wildcard route MUST come AFTER /default routes
  // ============================================

  /**
   * DELETE /user/model-override/:personalityId
   * Remove model override for a personality
   */
  router.delete(
    '/:personalityId',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;
      const personalityId = getParam(req.params.personalityId);

      // Get user ID
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      if (user === null) {
        return sendError(res, ErrorResponses.notFound('User not found'));
      }

      // Find the override
      const override = await prisma.userPersonalityConfig.findFirst({
        where: {
          userId: user.id,
          personalityId,
        },
        select: { id: true, llmConfigId: true, personality: { select: { name: true } } },
      });

      // Idempotent: if no override exists or llmConfigId is already null, return success
      if (override?.llmConfigId === null || override?.llmConfigId === undefined) {
        logger.info(
          { discordUserId, personalityId, hadOverride: false },
          '[ModelOverride] Reset called but no override was set (idempotent success)'
        );
        return sendCustomSuccess(res, { deleted: true, wasSet: false }, StatusCodes.OK);
      }

      // Remove the override (set llmConfigId to null)
      await prisma.userPersonalityConfig.update({
        where: { id: override.id },
        data: { llmConfigId: null },
      });

      logger.info(
        { discordUserId, personalityId, personalityName: override.personality.name },
        '[ModelOverride] Removed override'
      );

      sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
    })
  );

  return router;
}
