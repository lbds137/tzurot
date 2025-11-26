/**
 * User LLM Config Routes
 * CRUD operations for user-owned LLM configurations
 *
 * Endpoints:
 * - GET /user/llm-config - List configs (global + user)
 * - POST /user/llm-config - Create user config
 * - DELETE /user/llm-config/:id - Delete user config
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient } from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('user-llm-config');

/**
 * Config summary returned in list response
 */
interface LlmConfigSummary {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  visionModel: string | null;
  isGlobal: boolean;
  isDefault: boolean;
  isOwned: boolean; // True if user owns this config
}

/**
 * Request body for creating a config
 */
interface CreateConfigBody {
  name: string;
  description?: string;
  provider?: string;
  model: string;
  visionModel?: string;
  temperature?: number;
  maxReferencedMessages?: number;
}

export function createLlmConfigRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /user/llm-config
   * List all configs visible to the user (global + user-owned)
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

      // Get global configs
      const globalConfigs = await prisma.llmConfig.findMany({
        where: { isGlobal: true },
        select: {
          id: true,
          name: true,
          description: true,
          provider: true,
          model: true,
          visionModel: true,
          isGlobal: true,
          isDefault: true,
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });

      // Get user-owned configs (if user exists)
      const userConfigs =
        user !== null
          ? await prisma.llmConfig.findMany({
              where: { ownerId: user.id, isGlobal: false },
              select: {
                id: true,
                name: true,
                description: true,
                provider: true,
                model: true,
                visionModel: true,
                isGlobal: true,
                isDefault: true,
              },
              orderBy: { name: 'asc' },
            })
          : [];

      // Combine and format
      const configs: LlmConfigSummary[] = [
        ...globalConfigs.map(c => ({ ...c, isOwned: false })),
        ...userConfigs.map(c => ({ ...c, isOwned: true })),
      ];

      logger.info(
        { discordUserId, globalCount: globalConfigs.length, userCount: userConfigs.length },
        '[LlmConfig] Listed configs'
      );

      sendCustomSuccess(res, { configs }, StatusCodes.OK);
    })
  );

  /**
   * POST /user/llm-config
   * Create a new user-owned config
   */
  router.post(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: Request, res: Response) => {
      const discordUserId = (req as Request & { userId: string }).userId;
      const body = req.body as CreateConfigBody;

      // Validate required fields
      if (!body.name || body.name.trim().length === 0) {
        return sendError(res, ErrorResponses.validationError('name is required'));
      }
      if (!body.model || body.model.trim().length === 0) {
        return sendError(res, ErrorResponses.validationError('model is required'));
      }

      // Name length validation
      if (body.name.length > 100) {
        return sendError(
          res,
          ErrorResponses.validationError('name must be 100 characters or less')
        );
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

      // Check for duplicate name (user's configs only)
      const existing = await prisma.llmConfig.findFirst({
        where: {
          ownerId: user.id,
          name: body.name.trim(),
        },
      });

      if (existing !== null) {
        return sendError(
          res,
          ErrorResponses.validationError(`You already have a config named "${body.name}"`)
        );
      }

      // Create the config
      const config = await prisma.llmConfig.create({
        data: {
          name: body.name.trim(),
          description: body.description ?? null,
          ownerId: user.id,
          isGlobal: false,
          isDefault: false,
          provider: body.provider ?? 'openrouter',
          model: body.model.trim(),
          visionModel: body.visionModel ?? null,
          temperature: body.temperature ?? null,
          maxReferencedMessages: body.maxReferencedMessages ?? 20,
        },
        select: {
          id: true,
          name: true,
          description: true,
          provider: true,
          model: true,
          visionModel: true,
          isGlobal: true,
          isDefault: true,
        },
      });

      logger.info(
        { discordUserId, configId: config.id, name: config.name },
        '[LlmConfig] Created config'
      );

      sendCustomSuccess(
        res,
        {
          config: { ...config, isOwned: true },
        },
        StatusCodes.CREATED
      );
    })
  );

  /**
   * DELETE /user/llm-config/:id
   * Delete a user-owned config
   */
  router.delete(
    '/:id',
    requireUserAuth(),
    asyncHandler(async (req: Request, res: Response) => {
      const discordUserId = (req as Request & { userId: string }).userId;
      const configId = req.params.id;

      // Get user ID
      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { id: true },
      });

      if (user === null) {
        return sendError(res, ErrorResponses.notFound('User not found'));
      }

      // Find the config
      const config = await prisma.llmConfig.findFirst({
        where: { id: configId },
        select: { id: true, ownerId: true, isGlobal: true, name: true },
      });

      if (config === null) {
        return sendError(res, ErrorResponses.notFound('Config not found'));
      }

      // Check ownership
      if (config.isGlobal || config.ownerId !== user.id) {
        return sendError(res, ErrorResponses.unauthorized('You can only delete your own configs'));
      }

      // Check if config is in use by any UserPersonalityConfig
      const inUseCount = await prisma.userPersonalityConfig.count({
        where: { llmConfigId: configId },
      });

      if (inUseCount > 0) {
        return sendError(
          res,
          ErrorResponses.validationError(
            `Cannot delete: config is in use by ${inUseCount} personality override(s). Remove those overrides first.`
          )
        );
      }

      // Delete
      await prisma.llmConfig.delete({
        where: { id: configId },
      });

      logger.info({ discordUserId, configId, name: config.name }, '[LlmConfig] Deleted config');

      sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
    })
  );

  return router;
}
