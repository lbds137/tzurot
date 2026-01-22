/**
 * User LLM Config Routes
 * CRUD operations for user-owned LLM configurations
 *
 * Endpoints:
 * - GET /user/llm-config - List configs (global + user)
 * - GET /user/llm-config/:id - Get single config with full params
 * - POST /user/llm-config - Create user config
 * - PUT /user/llm-config/:id - Update user config (advancedParameters)
 * - DELETE /user/llm-config/:id - Delete user config
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import {
  createLogger,
  UserService,
  type PrismaClient,
  type LlmConfigSummary,
  type LlmConfigCacheInvalidationService,
  generateLlmConfigUuid,
  safeValidateAdvancedParams,
  computeLlmConfigPermissions,
  AdvancedParamsSchema,
  type AdvancedParams,
  AI_DEFAULTS,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-llm-config');

/**
 * Request body for creating/updating a config
 * All sampling params go into advancedParameters JSONB
 */
interface CreateConfigBody {
  name: string;
  description?: string;
  provider?: string;
  model: string;
  visionModel?: string;
  maxReferencedMessages?: number;
  // All params stored in advancedParameters
  advancedParameters?: AdvancedParams;
}

/**
 * Zod schema for UpdateConfigBody request validation.
 * Uses proper type coercion and validation at the service boundary.
 */
const UpdateConfigBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().min(1).optional(),
  visionModel: z.string().nullable().optional(),
  maxReferencedMessages: z.number().int().positive().optional(),
  advancedParameters: AdvancedParamsSchema.optional(),
  /** Toggle global visibility - users can share their presets */
  isGlobal: z.boolean().optional(),
});

// Type is exported for use in tests and documentation
export type UpdateConfigBody = z.infer<typeof UpdateConfigBodySchema>;

/** Select fields for list queries (summary data) */
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

/** Select fields for detail queries (includes advancedParameters) */
const CONFIG_DETAIL_SELECT = {
  ...CONFIG_SELECT,
  advancedParameters: true,
  maxReferencedMessages: true,
  memoryScoreThreshold: true,
  memoryLimit: true,
  ownerId: true,
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
      take: 100,
    });

    const userConfigs =
      user !== null
        ? await prisma.llmConfig.findMany({
            where: { ownerId: user.id, isGlobal: false },
            select: CONFIG_SELECT,
            orderBy: { name: 'asc' },
            take: 100,
          })
        : [];

    const configs: LlmConfigSummary[] = [
      ...globalConfigs.map(c => ({
        ...c,
        isOwned: false,
        permissions: computeLlmConfigPermissions(
          { ownerId: null, isGlobal: true },
          user?.id ?? null,
          discordUserId
        ),
      })),
      ...userConfigs.map(c => ({
        ...c,
        isOwned: true,
        permissions: computeLlmConfigPermissions(
          { ownerId: user?.id ?? null, isGlobal: false },
          user?.id ?? null,
          discordUserId
        ),
      })),
    ];

    logger.info(
      { discordUserId, globalCount: globalConfigs.length, userCount: userConfigs.length },
      '[LlmConfig] Listed configs'
    );

    sendCustomSuccess(res, { configs }, StatusCodes.OK);
  };
}

function createGetHandler(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getParam(req.params.id);

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    const config = await prisma.llmConfig.findUnique({
      where: { id: configId },
      select: CONFIG_DETAIL_SELECT,
    });

    if (config === null) {
      return sendError(res, ErrorResponses.notFound('Config not found'));
    }

    // Determine if user owns this config
    const isOwned = config.ownerId !== null && user !== null && config.ownerId === user.id;

    // Parse advancedParameters with validation
    const params = safeValidateAdvancedParams(config.advancedParameters) ?? {};

    // Compute permissions
    const permissions = computeLlmConfigPermissions(
      { ownerId: config.ownerId, isGlobal: config.isGlobal },
      user?.id ?? null,
      discordUserId
    );

    // Build response with parsed params
    const response = {
      id: config.id,
      name: config.name,
      description: config.description,
      provider: config.provider,
      model: config.model,
      visionModel: config.visionModel,
      isGlobal: config.isGlobal,
      isDefault: config.isDefault,
      isOwned,
      permissions,
      maxReferencedMessages: config.maxReferencedMessages,
      memoryScoreThreshold: config.memoryScoreThreshold?.toNumber() ?? null,
      memoryLimit: config.memoryLimit,
      params,
    };

    logger.debug({ discordUserId, configId }, '[LlmConfig] Fetched config');
    sendCustomSuccess(res, { config: response }, StatusCodes.OK);
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

    // Validate advancedParameters if provided
    if (body.advancedParameters !== undefined) {
      const validated = safeValidateAdvancedParams(body.advancedParameters);
      if (validated === null) {
        return sendError(res, ErrorResponses.validationError('Invalid advancedParameters'));
      }
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
        maxReferencedMessages: body.maxReferencedMessages ?? AI_DEFAULTS.MAX_REFERENCED_MESSAGES,
        memoryScoreThreshold: AI_DEFAULTS.MEMORY_SCORE_THRESHOLD,
        memoryLimit: AI_DEFAULTS.MEMORY_LIMIT,
        advancedParameters: body.advancedParameters ?? undefined,
      },
      select: CONFIG_DETAIL_SELECT,
    });

    // User always owns their own created config
    const permissions = computeLlmConfigPermissions(
      { ownerId: userId, isGlobal: false },
      userId,
      discordUserId
    );

    // Parse advancedParameters for response (matching get handler format)
    const params = safeValidateAdvancedParams(config.advancedParameters) ?? {};

    logger.info(
      { discordUserId, configId: config.id, name: config.name },
      '[LlmConfig] Created config'
    );
    sendCustomSuccess(
      res,
      {
        config: {
          id: config.id,
          name: config.name,
          description: config.description,
          provider: config.provider,
          model: config.model,
          visionModel: config.visionModel,
          isGlobal: config.isGlobal,
          isDefault: config.isDefault,
          isOwned: true,
          permissions,
          maxReferencedMessages: config.maxReferencedMessages,
          memoryScoreThreshold: config.memoryScoreThreshold?.toNumber() ?? null,
          memoryLimit: config.memoryLimit,
          params,
        },
      },
      StatusCodes.CREATED
    );
  };
}

// eslint-disable-next-line max-lines-per-function -- validating many optional fields in a PUT handler
function createUpdateHandler(
  prisma: PrismaClient,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService
) {
  // eslint-disable-next-line max-lines-per-function, complexity -- straightforward field validation in PUT handler
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getParam(req.params.id);

    // Validate request body with Zod schema
    const parseResult = UpdateConfigBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      const fieldPath = firstIssue.path.join('.');
      const message = fieldPath ? `${fieldPath}: ${firstIssue.message}` : firstIssue.message;
      return sendError(res, ErrorResponses.validationError(message));
    }
    const body = parseResult.data;

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.notFound('User not found'));
    }

    const config = await prisma.llmConfig.findUnique({
      where: { id: configId },
      select: { id: true, ownerId: true, isGlobal: true, name: true },
    });

    if (config === null) {
      return sendError(res, ErrorResponses.notFound('Config not found'));
    }

    // Users can only edit configs they own (including their own global presets)
    if (config.ownerId !== user.id) {
      return sendError(res, ErrorResponses.unauthorized('You can only edit your own configs'));
    }

    // Build update data from validated body
    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) {
      // Check for duplicate name (excluding current config)
      const duplicate = await prisma.llmConfig.findFirst({
        where: { ownerId: user.id, name: body.name.trim(), id: { not: configId } },
      });
      if (duplicate !== null) {
        return sendError(
          res,
          ErrorResponses.validationError(`You already have a config named "${body.name}"`)
        );
      }
      updateData.name = body.name.trim();
    }

    if (body.description !== undefined) {
      updateData.description = body.description;
    }
    if (body.provider !== undefined) {
      updateData.provider = body.provider;
    }
    if (body.model !== undefined) {
      updateData.model = body.model.trim();
    }
    if (body.visionModel !== undefined) {
      updateData.visionModel = body.visionModel;
    }
    if (body.maxReferencedMessages !== undefined) {
      updateData.maxReferencedMessages = body.maxReferencedMessages;
    }
    if (body.isGlobal !== undefined) {
      updateData.isGlobal = body.isGlobal;
    }
    if (body.advancedParameters !== undefined) {
      updateData.advancedParameters = body.advancedParameters;
    }

    if (Object.keys(updateData).length === 0) {
      return sendError(res, ErrorResponses.validationError('No fields to update'));
    }

    const updated = await prisma.llmConfig.update({
      where: { id: configId },
      data: updateData,
      select: CONFIG_DETAIL_SELECT,
    });

    // Parse advancedParameters for response
    const params = safeValidateAdvancedParams(updated.advancedParameters) ?? {};

    // User always owns their own updated config (we already checked ownership above)
    const permissions = computeLlmConfigPermissions(
      { ownerId: user.id, isGlobal: updated.isGlobal },
      user.id,
      discordUserId
    );

    const response = {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      provider: updated.provider,
      model: updated.model,
      visionModel: updated.visionModel,
      isGlobal: updated.isGlobal,
      isDefault: updated.isDefault,
      isOwned: true,
      permissions,
      maxReferencedMessages: updated.maxReferencedMessages,
      memoryScoreThreshold: updated.memoryScoreThreshold?.toNumber() ?? null,
      memoryLimit: updated.memoryLimit,
      params,
    };

    logger.info(
      { discordUserId, configId, name: updated.name, updates: Object.keys(updateData) },
      '[LlmConfig] Updated config'
    );

    // Invalidate cache for the user who owns this config
    if (llmConfigCacheInvalidation) {
      try {
        await llmConfigCacheInvalidation.invalidateUserLlmConfig(discordUserId);
      } catch (err) {
        logger.error({ err, configId }, '[LlmConfig] Failed to invalidate cache');
      }
    }

    sendCustomSuccess(res, { config: response }, StatusCodes.OK);
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

    // Use centralized permission computation for consistency
    const permissions = computeLlmConfigPermissions(config, user.id, discordUserId);
    if (!permissions.canDelete) {
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

export function createLlmConfigRoutes(
  prisma: PrismaClient,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService
): Router {
  const router = Router();
  const userService = new UserService(prisma);

  router.get('/', requireUserAuth(), asyncHandler(createListHandler(prisma)));
  router.get('/:id', requireUserAuth(), asyncHandler(createGetHandler(prisma)));
  router.post('/', requireUserAuth(), asyncHandler(createCreateHandler(prisma, userService)));
  router.put(
    '/:id',
    requireUserAuth(),
    asyncHandler(createUpdateHandler(prisma, llmConfigCacheInvalidation))
  );
  router.delete('/:id', requireUserAuth(), asyncHandler(createDeleteHandler(prisma)));

  return router;
}
