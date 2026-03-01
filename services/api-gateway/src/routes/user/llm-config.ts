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
  LlmConfigResolver,
  ConfigCascadeResolver,
  isBotOwner,
  type PrismaClient,
  type LlmConfigSummary,
  type LlmConfigCacheInvalidationService,
  type LoadedPersonality,
  computeLlmConfigPermissions,
  // Shared schemas from common-types - single source of truth
  LlmConfigCreateSchema,
  LlmConfigUpdateSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { getParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../types.js';
import { LlmConfigService, type LlmConfigScope } from '../../services/LlmConfigService.js';
import type { OpenRouterModelCache } from '../../services/OpenRouterModelCache.js';
import {
  validateModelAndContextWindow,
  enrichWithModelContext,
} from '../../utils/modelValidation.js';

const logger = createLogger('user-llm-config');

/** Common error message for config not found */
const CONFIG_RESOURCE = 'Config';

// ============================================================================
// Schemas - imported from @tzurot/common-types (single source of truth)
// ============================================================================

// --- Handler Factories ---

function createListHandler(service: LlmConfigService, prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Get user's internal ID for scope
    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    // Admin sees all presets (same pattern as character browse)
    // Regular users see global + their own
    const isAdmin = isBotOwner(discordUserId);
    const scope: LlmConfigScope = isAdmin
      ? { type: 'GLOBAL' }
      : { type: 'USER', userId: user?.id ?? 'anonymous', discordId: discordUserId };

    const rawConfigs = await service.list(scope);

    // Enrich with ownership and permissions (user-specific)
    const configs: LlmConfigSummary[] = rawConfigs.map(c => ({
      ...c,
      isOwned: user !== null && c.ownerId === user.id,
      permissions: computeLlmConfigPermissions(
        { ownerId: c.ownerId, isGlobal: c.isGlobal },
        user?.id ?? null,
        discordUserId
      ),
    }));

    logger.info({ discordUserId, count: configs.length }, '[LlmConfig] Listed configs');
    sendCustomSuccess(res, { configs }, StatusCodes.OK);
  };
}

function createGetHandler(
  service: LlmConfigService,
  prisma: PrismaClient,
  modelCache?: OpenRouterModelCache
) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getParam(req.params.id);

    // Use service to get config
    const config = await service.getById(configId ?? '');
    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_RESOURCE));
    }

    // Get user for ownership/permission check
    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    // Determine if user owns this config
    const isOwned = config.ownerId !== null && user !== null && config.ownerId === user.id;

    // Compute permissions
    const permissions = computeLlmConfigPermissions(
      { ownerId: config.ownerId, isGlobal: config.isGlobal },
      user?.id ?? null,
      discordUserId
    );

    // Format with service helper, then add user-specific fields
    const formatted = service.formatConfigDetail(config);
    await enrichWithModelContext(formatted, config.model, modelCache);

    logger.debug({ discordUserId, configId }, '[LlmConfig] Fetched config');
    sendCustomSuccess(res, { config: { ...formatted, isOwned, permissions } }, StatusCodes.OK);
  };
}

function createCreateHandler(
  service: LlmConfigService,
  userService: UserService,
  modelCache?: OpenRouterModelCache
) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Validate request body with shared Zod schema from common-types
    const parseResult = LlmConfigCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const body = parseResult.data;

    // Validate model ID and context window cap
    const modelValidation = await validateModelAndContextWindow(
      modelCache,
      body.model,
      body.contextWindowTokens
    );
    if (modelValidation.error !== undefined) {
      return sendError(res, ErrorResponses.validationError(modelValidation.error));
    }

    // Get or create user
    const userId = await userService.getOrCreateUser(discordUserId, discordUserId);
    if (userId === null) {
      return sendError(res, ErrorResponses.validationError('Cannot create user for bot'));
    }

    // Check for duplicate name using service
    const nameCheck = await service.checkNameExists(body.name, {
      type: 'USER',
      userId,
      discordId: discordUserId,
    });
    if (nameCheck.exists) {
      return sendError(
        res,
        ErrorResponses.validationError(`You already have a config named "${body.name}"`)
      );
    }

    // Create config using service
    const config = await service.create(
      { type: 'USER', userId, discordId: discordUserId },
      body,
      userId
    );

    // User always owns their own created config
    const permissions = computeLlmConfigPermissions(
      { ownerId: userId, isGlobal: false },
      userId,
      discordUserId
    );

    // Format with service helper, then add user-specific fields
    const formatted = service.formatConfigDetail(config);
    await enrichWithModelContext(formatted, config.model, modelCache);

    logger.info(
      { discordUserId, configId: config.id, name: config.name },
      '[LlmConfig] Created config'
    );
    sendCustomSuccess(
      res,
      { config: { ...formatted, isOwned: true, permissions } },
      StatusCodes.CREATED
    );
  };
}

function createUpdateHandler(
  service: LlmConfigService,
  prisma: PrismaClient,
  modelCache?: OpenRouterModelCache
) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getParam(req.params.id);

    // Validate request body with shared Zod schema from common-types
    const parseResult = LlmConfigUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const body = parseResult.data;

    // Validate model ID and context window cap if either is being updated
    if (body.model !== undefined || body.contextWindowTokens !== undefined) {
      // For context window validation, we need the effective model:
      // use the new model if provided, otherwise look up the existing config's model
      let effectiveModel = body.model;
      if (effectiveModel === undefined) {
        const existing = await service.getById(configId ?? '');
        effectiveModel = existing?.model;
      }
      const modelValidation = await validateModelAndContextWindow(
        modelCache,
        effectiveModel,
        body.contextWindowTokens
      );
      if (modelValidation.error !== undefined) {
        return sendError(res, ErrorResponses.validationError(modelValidation.error));
      }
    }

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.notFound('User'));
    }

    // Get existing config using service
    const config = await service.getById(configId ?? '');
    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_RESOURCE));
    }

    // Users can only edit configs they own (including their own global presets)
    if (config.ownerId !== user.id) {
      return sendError(res, ErrorResponses.unauthorized('You can only edit your own configs'));
    }

    // Check for duplicate name if name is being changed
    if (body.name !== undefined) {
      const nameCheck = await service.checkNameExists(
        body.name,
        { type: 'USER', userId: user.id, discordId: discordUserId },
        configId ?? ''
      );
      if (nameCheck.exists) {
        return sendError(
          res,
          ErrorResponses.validationError(`You already have a config named "${body.name}"`)
        );
      }
    }

    if (Object.keys(body).length === 0) {
      return sendError(res, ErrorResponses.validationError('No fields to update'));
    }

    // Update using service (handles cache invalidation)
    const updated = await service.update(configId ?? '', body);

    // User always owns their own updated config (we already checked ownership above)
    const permissions = computeLlmConfigPermissions(
      { ownerId: user.id, isGlobal: updated.isGlobal },
      user.id,
      discordUserId
    );

    // Format with service helper, then add user-specific fields
    const formatted = service.formatConfigDetail(updated);
    await enrichWithModelContext(formatted, updated.model, modelCache);

    logger.info(
      { discordUserId, configId, name: updated.name, updates: Object.keys(body) },
      '[LlmConfig] Updated config'
    );

    sendCustomSuccess(
      res,
      { config: { ...formatted, isOwned: true, permissions } },
      StatusCodes.OK
    );
  };
}

function createDeleteHandler(service: LlmConfigService, prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getParam(req.params.id);

    const user = await prisma.user.findFirst({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (user === null) {
      return sendError(res, ErrorResponses.notFound('User'));
    }

    // Get config using service
    const config = await service.getById(configId ?? '');
    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_RESOURCE));
    }

    // Use centralized permission computation for consistency
    const permissions = computeLlmConfigPermissions(
      { ownerId: config.ownerId, isGlobal: config.isGlobal },
      user.id,
      discordUserId
    );
    if (!permissions.canDelete) {
      return sendError(res, ErrorResponses.unauthorized('You can only delete your own configs'));
    }

    // Check delete constraints using service
    const constraintError = await service.checkDeleteConstraints(configId ?? '');
    if (constraintError !== null) {
      return sendError(res, ErrorResponses.validationError(constraintError));
    }

    // Delete using service (handles cache invalidation)
    await service.delete(configId ?? '');

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
  channelId?: string;
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
  channelId: z.string().min(1).optional(),
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
  // Create resolvers with cleanup disabled (short-lived request handler)
  const resolver = new LlmConfigResolver(prisma, { enableCleanup: false });
  const cascadeResolver = new ConfigCascadeResolver(prisma, { enableCleanup: false });

  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = resolveConfigBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, ErrorResponses.validationError(parseResult.error.message));
    }

    const { personalityId, personalityConfig, channelId } = parseResult.data as ResolveConfigBody;

    try {
      const [result, overrides] = await Promise.all([
        resolver.resolveConfig(discordUserId, personalityId, personalityConfig),
        cascadeResolver.resolveOverrides(discordUserId, personalityId, channelId),
      ]);

      logger.debug(
        { discordUserId, personalityId, source: result.source },
        '[LlmConfig] Config resolved'
      );

      sendCustomSuccess(res, { ...result, overrides }, StatusCodes.OK);
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
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService,
  modelCache?: OpenRouterModelCache
): Router {
  const router = Router();

  // Instantiate services with dependencies
  const service = new LlmConfigService(prisma, llmConfigCacheInvalidation);
  const userService = new UserService(prisma);

  router.get('/', requireUserAuth(), asyncHandler(createListHandler(service, prisma)));
  router.get(
    '/:id',
    requireUserAuth(),
    asyncHandler(createGetHandler(service, prisma, modelCache))
  );
  router.post(
    '/',
    requireUserAuth(),
    asyncHandler(createCreateHandler(service, userService, modelCache))
  );
  router.post('/resolve', requireUserAuth(), asyncHandler(createResolveHandler(prisma)));
  router.put(
    '/:id',
    requireUserAuth(),
    asyncHandler(createUpdateHandler(service, prisma, modelCache))
  );
  router.delete('/:id', requireUserAuth(), asyncHandler(createDeleteHandler(service, prisma)));

  return router;
}
