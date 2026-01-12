/**
 * User LLM Config Routes
 * CRUD operations for user-owned LLM configurations
 *
 * Endpoints:
 * - GET /user/llm-config - List configs (global + user)
 * - POST /user/llm-config - Create user config
 * - DELETE /user/llm-config/:id - Delete user config
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  UserService,
  type PrismaClient,
  type LlmConfigSummary,
  generateLlmConfigUuid,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-llm-config');

interface CreateConfigBody {
  name: string;
  description?: string;
  provider?: string;
  model: string;
  visionModel?: string;
  temperature?: number;
  maxReferencedMessages?: number;
}

const CONFIG_SELECT = {
  id: true,
  name: true,
  description: true,
  provider: true,
  model: true,
  visionModel: true,
  isGlobal: true,
  isDefault: true,
} as const;

// --- Handler Factories ---

function createListHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    const globalConfigs = await prisma.llmConfig.findMany({
      where: { isGlobal: true },
      select: CONFIG_SELECT,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    const userConfigs =
      user !== null
        ? await prisma.llmConfig.findMany({
            where: { ownerId: user.id, isGlobal: false },
            select: CONFIG_SELECT,
            orderBy: { name: 'asc' },
          })
        : [];

    const configs: LlmConfigSummary[] = [
      ...globalConfigs.map(c => ({ ...c, isOwned: false })),
      ...userConfigs.map(c => ({ ...c, isOwned: true })),
    ];

    logger.info(
      { discordUserId, globalCount: globalConfigs.length, userCount: userConfigs.length },
      '[LlmConfig] Listed configs'
    );

    sendCustomSuccess(res, { configs }, StatusCodes.OK);
  };
}

function createCreateHandler(prisma: PrismaClient, userService: UserService) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const body = req.body as CreateConfigBody;

    // Validate required fields
    if (!body.name || body.name.trim().length === 0) {
      return sendError(res, ErrorResponses.validationError('name is required'));
    }
    if (!body.model || body.model.trim().length === 0) {
      return sendError(res, ErrorResponses.validationError('model is required'));
    }
    if (body.name.length > 100) {
      return sendError(res, ErrorResponses.validationError('name must be 100 characters or less'));
    }

    // Get or create user
    const userId = await userService.getOrCreateUser(discordUserId, discordUserId);
    if (userId === null) {
      return sendError(res, ErrorResponses.validationError('Cannot create user for bot'));
    }

    // Check for duplicate name
    const existing = await prisma.llmConfig.findFirst({
      where: { ownerId: userId, name: body.name.trim() },
    });
    if (existing !== null) {
      return sendError(
        res,
        ErrorResponses.validationError(`You already have a config named "${body.name}"`)
      );
    }

    const config = await prisma.llmConfig.create({
      data: {
        id: generateLlmConfigUuid(body.name.trim()),
        name: body.name.trim(),
        description: body.description ?? null,
        ownerId: userId,
        isGlobal: false,
        isDefault: false,
        provider: body.provider ?? 'openrouter',
        model: body.model.trim(),
        visionModel: body.visionModel ?? null,
        temperature: body.temperature ?? null,
        maxReferencedMessages: body.maxReferencedMessages ?? 20,
      },
      select: CONFIG_SELECT,
    });

    logger.info(
      { discordUserId, configId: config.id, name: config.name },
      '[LlmConfig] Created config'
    );
    sendCustomSuccess(res, { config: { ...config, isOwned: true } }, StatusCodes.CREATED);
  };
}

function createDeleteHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getParam(req.params.id);

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.notFound('User not found'));
    }

    const config = await prisma.llmConfig.findFirst({
      where: { id: configId },
      select: { id: true, ownerId: true, isGlobal: true, name: true },
    });

    if (config === null) {
      return sendError(res, ErrorResponses.notFound('Config not found'));
    }
    if (config.isGlobal || config.ownerId !== user.id) {
      return sendError(res, ErrorResponses.unauthorized('You can only delete your own configs'));
    }

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

    await prisma.llmConfig.delete({ where: { id: configId } });

    logger.info({ discordUserId, configId, name: config.name }, '[LlmConfig] Deleted config');
    sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
  };
}

// --- Main Route Factory ---

export function createLlmConfigRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const userService = new UserService(prisma);

  router.get('/', requireUserAuth(), asyncHandler(createListHandler(prisma)));
  router.post('/', requireUserAuth(), asyncHandler(createCreateHandler(prisma, userService)));
  router.delete('/:id', requireUserAuth(), asyncHandler(createDeleteHandler(prisma)));

  return router;
}
