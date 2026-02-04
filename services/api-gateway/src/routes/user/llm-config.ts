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
/* eslint-disable max-lines -- CRUD route file with multiple handlers */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import {
  createLogger,
  UserService,
  LlmConfigResolver,
  type PrismaClient,
  type LlmConfigSummary,
  type LlmConfigCacheInvalidationService,
  type LoadedPersonality,
  generateLlmConfigUuid,
  safeValidateAdvancedParams,
  computeLlmConfigPermissions,
  AdvancedParamsSchema,
  AI_DEFAULTS,
  MESSAGE_LIMITS,
  optionalString,
  nullableString,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-llm-config');

/** Common error message for config not found */
const CONFIG_NOT_FOUND = 'Config not found';

/**
 * Shared context settings schema - used by both create and update handlers.
 * Validation bounds prevent DoS via excessive history fetch.
 * - maxMessages: 1-100 (capped at MAX_EXTENDED_CONTEXT)
 * - maxImages: 0-20 (0 disables image processing, capped at MAX_CONTEXT_IMAGES)
 * - maxAge: 1-2592000 (30 days) or null (null = no time limit)
 */
const ContextSettingsSchema = {
  maxMessages: z
    .number()
    .int()
    .min(1, 'maxMessages must be at least 1')
    .max(
      MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT,
      `maxMessages cannot exceed ${MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT}`
    )
    .optional(),
  maxAge: z
    .number()
    .int()
    .min(1, 'maxAge must be at least 1 second, or omit/set to null for no time limit')
    .max(
      MESSAGE_LIMITS.MAX_CONTEXT_AGE,
      `maxAge cannot exceed ${MESSAGE_LIMITS.MAX_CONTEXT_AGE} seconds (30 days)`
    )
    .optional()
    .nullable(),
  maxImages: z
    .number()
    .int()
    .min(0, 'maxImages must be at least 0 (0 disables image processing)')
    .max(
      MESSAGE_LIMITS.MAX_CONTEXT_IMAGES,
      `maxImages cannot exceed ${MESSAGE_LIMITS.MAX_CONTEXT_IMAGES}`
    )
    .optional(),
};

/**
 * Zod schema for CreateConfigBody request validation.
 */
const CreateConfigBodySchema = z.object({
  name: z.string().min(1, 'name is required').max(100, 'name must be 100 characters or less'),
  description: z.string().max(500).optional().nullable(),
  provider: z.string().max(50).optional(),
  model: z.string().min(1, 'model is required').max(200),
  visionModel: z.string().max(200).optional().nullable(),
  maxReferencedMessages: z.number().int().positive().optional(),
  memoryScoreThreshold: z.number().min(0).max(1).optional().nullable(),
  memoryLimit: z.number().int().positive().optional().nullable(),
  contextWindowTokens: z.number().int().positive().optional(),
  // Context settings
  ...ContextSettingsSchema,
  advancedParameters: AdvancedParamsSchema.optional(),
});

// Type is exported for use in tests
export type CreateConfigBody = z.infer<typeof CreateConfigBodySchema>;

/**
 * Zod schema for UpdateConfigBody request validation.
 * Uses empty-to-undefined transforms so clients can send "" to "not update" a field.
 * This is the standard pattern for handling form inputs where clearing a field
 * sends empty string instead of omitting the field.
 */
const UpdateConfigBodySchema = z.object({
  // Required DB fields: empty string → undefined (preserve existing value)
  name: optionalString(100),
  provider: optionalString(50),
  model: optionalString(200),
  // Nullable DB fields: empty string → null (clear the value)
  description: nullableString(500),
  visionModel: nullableString(200),
  // Non-string fields
  maxReferencedMessages: z.number().int().positive().optional(),
  memoryScoreThreshold: z.number().min(0).max(1).optional().nullable(),
  memoryLimit: z.number().int().positive().optional().nullable(),
  contextWindowTokens: z.number().int().positive().optional(),
  // Context settings (shared validation)
  ...ContextSettingsSchema,
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
  ownerId: true,
} as const;

/** Select fields for detail queries (includes advancedParameters) */
const CONFIG_DETAIL_SELECT = {
  ...CONFIG_SELECT,
  advancedParameters: true,
  maxReferencedMessages: true,
  memoryScoreThreshold: true,
  memoryLimit: true,
  contextWindowTokens: true,
  // Context settings (typed columns)
  maxMessages: true,
  maxAge: true,
  maxImages: true,
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
          { ownerId: c.ownerId, isGlobal: true },
          user?.id ?? null,
          discordUserId
        ),
      })),
      ...userConfigs.map(c => ({
        ...c,
        isOwned: true,
        permissions: computeLlmConfigPermissions(
          { ownerId: c.ownerId, isGlobal: false },
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
      return sendError(res, ErrorResponses.notFound(CONFIG_NOT_FOUND));
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
      contextWindowTokens: config.contextWindowTokens,
      // Context settings
      maxMessages: config.maxMessages,
      maxAge: config.maxAge,
      maxImages: config.maxImages,
      params,
    };

    logger.debug({ discordUserId, configId }, '[LlmConfig] Fetched config');
    sendCustomSuccess(res, { config: response }, StatusCodes.OK);
  };
}

function createCreateHandler(prisma: PrismaClient, userService: UserService) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Validate request body with Zod schema
    const parseResult = CreateConfigBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      // Include field path for clearer error messages
      const path = firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ` : '';
      return sendError(res, ErrorResponses.validationError(`${path}${firstIssue.message}`));
    }
    const body = parseResult.data;

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
        memoryScoreThreshold: body.memoryScoreThreshold ?? AI_DEFAULTS.MEMORY_SCORE_THRESHOLD,
        memoryLimit: body.memoryLimit ?? AI_DEFAULTS.MEMORY_LIMIT,
        contextWindowTokens: body.contextWindowTokens ?? AI_DEFAULTS.CONTEXT_WINDOW_TOKENS,
        // Context settings
        maxMessages: body.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
        maxAge: body.maxAge ?? null,
        maxImages: body.maxImages ?? MESSAGE_LIMITS.DEFAULT_MAX_IMAGES,
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
          contextWindowTokens: config.contextWindowTokens,
          // Context settings
          maxMessages: config.maxMessages,
          maxAge: config.maxAge,
          maxImages: config.maxImages,
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
  // eslint-disable-next-line max-lines-per-function, complexity, max-statements, sonarjs/cognitive-complexity -- straightforward field validation in PUT handler
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
      return sendError(res, ErrorResponses.notFound(CONFIG_NOT_FOUND));
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
    if (body.memoryScoreThreshold !== undefined) {
      updateData.memoryScoreThreshold = body.memoryScoreThreshold;
    }
    if (body.memoryLimit !== undefined) {
      updateData.memoryLimit = body.memoryLimit;
    }
    if (body.contextWindowTokens !== undefined) {
      updateData.contextWindowTokens = body.contextWindowTokens;
    }
    if (body.isGlobal !== undefined) {
      updateData.isGlobal = body.isGlobal;
    }
    if (body.advancedParameters !== undefined) {
      updateData.advancedParameters = body.advancedParameters;
    }
    // Context settings
    if (body.maxMessages !== undefined) {
      updateData.maxMessages = body.maxMessages;
    }
    if (body.maxAge !== undefined) {
      updateData.maxAge = body.maxAge;
    }
    if (body.maxImages !== undefined) {
      updateData.maxImages = body.maxImages;
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
      contextWindowTokens: updated.contextWindowTokens,
      // Context settings
      maxMessages: updated.maxMessages,
      maxAge: updated.maxAge,
      maxImages: updated.maxImages,
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
      return sendError(res, ErrorResponses.notFound(CONFIG_NOT_FOUND));
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

// --- Resolve Handler ---

/**
 * Request body for resolving config
 * Bot-client sends this to get resolved config before context building
 */
interface ResolveConfigBody {
  personalityId: string;
  personalityConfig: LoadedPersonality;
}

const resolveConfigBodySchema = z.object({
  personalityId: z.string().min(1),
  personalityConfig: z
    .object({
      id: z.string(),
      name: z.string(),
      model: z.string(),
    })
    .passthrough(), // Allow additional LoadedPersonality fields
});

/**
 * Create resolve handler
 * POST /user/llm-config/resolve
 *
 * Resolves the effective LLM config for a user+personality combination.
 * Used by bot-client to get context settings (maxMessages, maxAge, maxImages)
 * before building conversation context.
 */
function createResolveHandler(prisma: PrismaClient) {
  // Create resolver with cleanup disabled (short-lived request handler)
  const resolver = new LlmConfigResolver(prisma, { enableCleanup: false });

  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = resolveConfigBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, ErrorResponses.validationError(parseResult.error.message));
    }

    const { personalityId, personalityConfig } = parseResult.data as ResolveConfigBody;

    try {
      const result = await resolver.resolveConfig(discordUserId, personalityId, personalityConfig);

      logger.debug(
        { discordUserId, personalityId, source: result.source },
        '[LlmConfig] Config resolved'
      );

      sendCustomSuccess(res, result, StatusCodes.OK);
    } catch (error) {
      logger.error(
        { err: error, discordUserId, personalityId },
        '[LlmConfig] Failed to resolve config'
      );
      return sendError(res, ErrorResponses.internalError('Failed to resolve config'));
    }
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
  router.post('/resolve', requireUserAuth(), asyncHandler(createResolveHandler(prisma)));
  router.put(
    '/:id',
    requireUserAuth(),
    asyncHandler(createUpdateHandler(prisma, llmConfigCacheInvalidation))
  );
  router.delete('/:id', requireUserAuth(), asyncHandler(createDeleteHandler(prisma)));

  return router;
}
