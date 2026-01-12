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
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-model-override');

/**
 * Request body for setting override
 */
interface SetOverrideBody {
  personalityId: string;
  configId: string;
}

/**
 * Request body for setting user's global default config
 */
interface SetDefaultBody {
  configId: string;
}

/**
 * Response for user default config
 */
interface UserDefaultConfigResponse {
  configId: string | null;
  configName: string | null;
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
      const body = req.body as SetOverrideBody;

      // Validate required fields
      if (!body.personalityId || body.personalityId.trim().length === 0) {
        return sendError(res, ErrorResponses.validationError('personalityId is required'));
      }
      if (!body.configId || body.configId.trim().length === 0) {
        return sendError(res, ErrorResponses.validationError('configId is required'));
      }

      // Get or create user via centralized UserService
      const userId = await userService.getOrCreateUser(discordUserId, discordUserId);
      if (userId === null) {
        // Should not happen for slash commands (bots can't use them)
        return sendError(res, ErrorResponses.validationError('Cannot create user for bot'));
      }

      // Verify personality exists
      const personality = await prisma.personality.findFirst({
        where: { id: body.personalityId },
        select: { id: true, name: true },
      });

      if (personality === null) {
        return sendError(res, ErrorResponses.notFound('Personality not found'));
      }

      // Verify config exists and user can access it
      const llmConfig = await prisma.llmConfig.findFirst({
        where: {
          id: body.configId,
          OR: [{ isGlobal: true }, { ownerId: userId }],
        },
        select: { id: true, name: true },
      });

      if (llmConfig === null) {
        return sendError(res, ErrorResponses.notFound('Config not found or not accessible'));
      }

      // Upsert the UserPersonalityConfig (use deterministic UUID for cross-env sync)
      const override = await prisma.userPersonalityConfig.upsert({
        where: {
          userId_personalityId: {
            userId,
            personalityId: body.personalityId,
          },
        },
        create: {
          id: generateUserPersonalityConfigUuid(userId, body.personalityId),
          userId,
          personalityId: body.personalityId,
          llmConfigId: body.configId,
        },
        update: {
          llmConfigId: body.configId,
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
          personalityId: body.personalityId,
          personalityName: personality.name,
          configId: body.configId,
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

      const result: UserDefaultConfigResponse = {
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
      const body = req.body as SetDefaultBody;

      // Validate required fields
      if (!body.configId || body.configId.trim().length === 0) {
        return sendError(res, ErrorResponses.validationError('configId is required'));
      }

      // Get or create user via centralized UserService
      const userId = await userService.getOrCreateUser(discordUserId, discordUserId);
      if (userId === null) {
        // Should not happen for slash commands (bots can't use them)
        return sendError(res, ErrorResponses.validationError('Cannot create user for bot'));
      }

      // Verify config exists and user can access it (global or owned)
      const llmConfig = await prisma.llmConfig.findFirst({
        where: {
          id: body.configId,
          OR: [{ isGlobal: true }, { ownerId: userId }],
        },
        select: { id: true, name: true },
      });

      if (llmConfig === null) {
        return sendError(res, ErrorResponses.notFound('Config not found or not accessible'));
      }

      // Update user's default config
      await prisma.user.update({
        where: { id: userId },
        data: { defaultLlmConfigId: body.configId },
      });

      const result: UserDefaultConfigResponse = {
        configId: llmConfig.id,
        configName: llmConfig.name,
      };

      logger.info(
        { discordUserId, configId: body.configId, configName: llmConfig.name },
        '[ModelDefault] Set default config'
      );

      // Invalidate user's LLM config cache so ai-worker picks up the change
      if (llmConfigCacheInvalidation) {
        try {
          await llmConfigCacheInvalidation.invalidateUserLlmConfig(discordUserId);
          logger.debug({ discordUserId }, '[ModelDefault] Invalidated user LLM config cache');
        } catch (err) {
          // Log but don't fail the request - cache will expire naturally
          logger.error({ err, discordUserId }, '[ModelDefault] Failed to invalidate cache');
        }
      }

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

      if (user.defaultLlmConfigId === null) {
        return sendError(res, ErrorResponses.validationError('No default config set'));
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { defaultLlmConfigId: null },
      });

      logger.info({ discordUserId }, '[ModelDefault] Cleared default config');

      // Invalidate user's LLM config cache so ai-worker picks up the change
      if (llmConfigCacheInvalidation) {
        try {
          await llmConfigCacheInvalidation.invalidateUserLlmConfig(discordUserId);
          logger.debug({ discordUserId }, '[ModelDefault] Invalidated user LLM config cache');
        } catch (err) {
          // Log but don't fail the request - cache will expire naturally
          logger.error({ err, discordUserId }, '[ModelDefault] Failed to invalidate cache');
        }
      }

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
