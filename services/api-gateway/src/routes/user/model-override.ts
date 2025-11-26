/**
 * User Model Override Routes
 * Set/reset LLM config overrides for personalities
 *
 * Endpoints:
 * - GET /user/model-override - List all user's model overrides
 * - PUT /user/model-override - Set override for a personality
 * - DELETE /user/model-override/:personalityId - Remove override
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient } from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('user-model-override');

/**
 * Override summary
 */
interface OverrideSummary {
  personalityId: string;
  personalityName: string;
  configId: string | null;
  configName: string | null;
}

/**
 * Request body for setting override
 */
interface SetOverrideBody {
  personalityId: string;
  configId: string;
}

export function createModelOverrideRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /user/model-override
   * List all model overrides for the user
   */
  router.get(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: Request, res: Response) => {
      const discordUserId = (req as Request & { userId: string }).userId;

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

      const result: OverrideSummary[] = overrides.map(o => ({
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
    asyncHandler(async (req: Request, res: Response) => {
      const discordUserId = (req as Request & { userId: string }).userId;
      const body = req.body as SetOverrideBody;

      // Validate required fields
      if (!body.personalityId || body.personalityId.trim().length === 0) {
        return sendError(res, ErrorResponses.validationError('personalityId is required'));
      }
      if (!body.configId || body.configId.trim().length === 0) {
        return sendError(res, ErrorResponses.validationError('configId is required'));
      }

      // Get or create user
      let user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      user ??= await prisma.user.create({
        data: {
          discordId: discordUserId,
          username: discordUserId, // Placeholder
          timezone: 'UTC',
        },
        select: { id: true },
      });

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
          OR: [{ isGlobal: true }, { ownerId: user.id }],
        },
        select: { id: true, name: true },
      });

      if (llmConfig === null) {
        return sendError(res, ErrorResponses.notFound('Config not found or not accessible'));
      }

      // Upsert the UserPersonalityConfig
      const override = await prisma.userPersonalityConfig.upsert({
        where: {
          userId_personalityId: {
            userId: user.id,
            personalityId: body.personalityId,
          },
        },
        create: {
          userId: user.id,
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

      const result: OverrideSummary = {
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

  /**
   * DELETE /user/model-override/:personalityId
   * Remove model override for a personality
   */
  router.delete(
    '/:personalityId',
    requireUserAuth(),
    asyncHandler(async (req: Request, res: Response) => {
      const discordUserId = (req as Request & { userId: string }).userId;
      const personalityId = req.params.personalityId;

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

      if (override === null) {
        return sendError(res, ErrorResponses.notFound('No override found for this personality'));
      }

      if (override.llmConfigId === null) {
        return sendError(
          res,
          ErrorResponses.validationError('No model override set for this personality')
        );
      }

      // Remove the override (set llmConfigId to null, or delete if no other data)
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
