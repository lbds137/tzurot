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
import {
  createLogger,
  type UserService,
  isBotOwner,
  type PrismaClient,
  type LlmConfigSummary,
  type LlmConfigCacheInvalidationService,
  type ConfigCascadeResolver,
  computeLlmConfigPermissions,
  // Shared schemas from common-types - single source of truth
  LlmConfigCreateSchema,
  LlmConfigUpdateSchema,
} from '@tzurot/common-types';
import {
  requireUserAuth,
  requireProvisionedUser,
  getOrCreateUserService,
} from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { isPrismaUniqueConstraintError } from '../../utils/prismaErrors.js';
import { getRequiredParam } from '../../utils/requestParams.js';
import type { ProvisionedRequest } from '../../types.js';
import {
  LlmConfigService,
  AutoSuffixCollisionError,
  CloneNameExhaustedError,
  type LlmConfigScope,
} from '../../services/LlmConfigService.js';
import type { OpenRouterModelCache } from '../../services/OpenRouterModelCache.js';
import { enrichWithModelContext } from '../../utils/modelValidation.js';
import { validateLlmConfigModelFields } from '../../utils/llmConfigValidation.js';
import { createResolveHandler } from './llmConfigResolve.js';

const logger = createLogger('user-llm-config');

/** Common error message for config not found */
const CONFIG_RESOURCE = 'Config';

// ============================================================================
// Schemas - imported from @tzurot/common-types (single source of truth)
// ============================================================================

// --- Handler Factories ---

function createListHandler(service: LlmConfigService, userService: UserService) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = await resolveProvisionedUserId(req, userService);

    // Admin sees all presets (same pattern as character browse)
    // Regular users see global + their own
    const isAdmin = isBotOwner(discordUserId);
    const scope: LlmConfigScope = isAdmin
      ? { type: 'GLOBAL' }
      : { type: 'USER', userId, discordId: discordUserId };

    const rawConfigs = await service.list(scope);

    // Enrich with ownership and permissions (user-specific)
    const configs: LlmConfigSummary[] = rawConfigs.map(c => ({
      ...c,
      isOwned: c.ownerId === userId,
      permissions: computeLlmConfigPermissions(
        { ownerId: c.ownerId, isGlobal: c.isGlobal },
        userId,
        discordUserId
      ),
    }));

    logger.info({ discordUserId, count: configs.length }, 'Listed configs');
    sendCustomSuccess(res, { configs }, StatusCodes.OK);
  };
}

function createGetHandler(
  service: LlmConfigService,
  userService: UserService,
  modelCache?: OpenRouterModelCache
) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getRequiredParam(req.params.id, 'id');

    // Use service to get config
    const config = await service.getById(configId);
    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_RESOURCE));
    }

    const userId = await resolveProvisionedUserId(req, userService);

    // Determine if user owns this config
    const isOwned = config.ownerId !== null && config.ownerId === userId;

    // Compute permissions
    const permissions = computeLlmConfigPermissions(
      { ownerId: config.ownerId, isGlobal: config.isGlobal },
      userId,
      discordUserId
    );

    // Format with service helper, then add user-specific fields
    const formatted = service.formatConfigDetail(config);
    await enrichWithModelContext(formatted, config.model, modelCache);

    logger.debug({ discordUserId, configId }, 'Fetched config');
    sendCustomSuccess(res, { config: { ...formatted, isOwned, permissions } }, StatusCodes.OK);
  };
}

function createCreateHandler(
  service: LlmConfigService,
  userService: UserService,
  modelCache?: OpenRouterModelCache
) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Validate request body with shared Zod schema from common-types
    const parseResult = LlmConfigCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const body = parseResult.data;

    if (!(await validateLlmConfigModelFields({ res, modelCache, body }))) {
      return;
    }

    const userId = await resolveProvisionedUserId(req, userService);

    // Duplicate-name check is skipped when the client opts into
    // autoSuffixOnCollision (the preset clone flow): the service will bump
    // the (Copy N) suffix server-side until it finds a free slot. For
    // regular creates, strict name-uniqueness still surfaces as an error.
    if (body.autoSuffixOnCollision !== true) {
      const nameCheck = await service.checkNameExists(body.name, {
        type: 'USER',
        userId,
        discordId: discordUserId,
      });
      if (nameCheck.exists) {
        return sendError(
          res,
          ErrorResponses.nameCollision(`You already have a config named "${body.name}"`)
        );
      }
    }

    // Create config using service. Three collision paths to translate:
    //  - Auto-suffix path raced — service wraps P2002 with the bumped name so
    //    we can cite the actual collided name (not `body.name`).
    //  - Auto-suffix path exhausted — pathological case, but map to a clear
    //    NAME_COLLISION so the client doesn't see an opaque 500.
    //  - Non-auto-suffix path raced past `checkNameExists` — defense-in-depth
    //    P2002 with the original requested name.
    let config;
    try {
      config = await service.create(
        { type: 'USER', userId, discordId: discordUserId },
        body,
        userId
      );
    } catch (err) {
      if (err instanceof AutoSuffixCollisionError) {
        return sendError(
          res,
          ErrorResponses.nameCollision(
            `Name "${err.effectiveName}" was taken by a concurrent request. Please try again.`
          )
        );
      }
      if (err instanceof CloneNameExhaustedError) {
        return sendError(
          res,
          ErrorResponses.nameCollision(
            `Too many copies of "${err.baseName}" already exist. Try renaming some before cloning again.`
          )
        );
      }
      if (isPrismaUniqueConstraintError(err)) {
        return sendError(
          res,
          ErrorResponses.nameCollision(`You already have a config named "${body.name}"`)
        );
      }
      throw err;
    }

    // User always owns their own created config
    const permissions = computeLlmConfigPermissions(
      { ownerId: userId, isGlobal: false },
      userId,
      discordUserId
    );

    // Format with service helper, then add user-specific fields
    const formatted = service.formatConfigDetail(config);
    await enrichWithModelContext(formatted, config.model, modelCache);

    logger.info({ discordUserId, configId: config.id, name: config.name }, 'Created config');
    sendCustomSuccess(
      res,
      { config: { ...formatted, isOwned: true, permissions } },
      StatusCodes.CREATED
    );
  };
}

function createUpdateHandler(
  service: LlmConfigService,
  userService: UserService,
  modelCache?: OpenRouterModelCache
) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getRequiredParam(req.params.id, 'id');

    // Validate request body with shared Zod schema from common-types
    const parseResult = LlmConfigUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const body = parseResult.data;

    if (
      !(await validateLlmConfigModelFields({
        res,
        modelCache,
        body,
        fallback: { service, configId: configId },
      }))
    ) {
      return;
    }

    const userId = await resolveProvisionedUserId(req, userService);

    // Get existing config using service
    const config = await service.getById(configId);
    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_RESOURCE));
    }

    // Users can only edit configs they own (including their own global presets)
    if (config.ownerId !== userId) {
      return sendError(res, ErrorResponses.unauthorized('You can only edit your own configs'));
    }

    // Check for duplicate name if name is being changed
    if (body.name !== undefined) {
      const nameCheck = await service.checkNameExists(
        body.name,
        { type: 'USER', userId, discordId: discordUserId },
        configId
      );
      if (nameCheck.exists) {
        return sendError(
          res,
          ErrorResponses.nameCollision(`You already have a config named "${body.name}"`)
        );
      }
    }

    if (Object.keys(body).length === 0) {
      return sendError(res, ErrorResponses.validationError('No fields to update'));
    }

    // Update using service (handles cache invalidation)
    const updated = await service.update(configId, body);

    // User always owns their own updated config (we already checked ownership above)
    const permissions = computeLlmConfigPermissions(
      { ownerId: userId, isGlobal: updated.isGlobal },
      userId,
      discordUserId
    );

    // Format with service helper, then add user-specific fields
    const formatted = service.formatConfigDetail(updated);
    await enrichWithModelContext(formatted, updated.model, modelCache);

    logger.info(
      { discordUserId, configId, name: updated.name, updates: Object.keys(body) },
      'Updated config'
    );

    sendCustomSuccess(
      res,
      { config: { ...formatted, isOwned: true, permissions } },
      StatusCodes.OK
    );
  };
}

function createDeleteHandler(service: LlmConfigService, userService: UserService) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getRequiredParam(req.params.id, 'id');

    const userId = await resolveProvisionedUserId(req, userService);

    // Get config using service
    const config = await service.getById(configId);
    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_RESOURCE));
    }

    // Use centralized permission computation for consistency
    const permissions = computeLlmConfigPermissions(
      { ownerId: config.ownerId, isGlobal: config.isGlobal },
      userId,
      discordUserId
    );
    if (!permissions.canDelete) {
      return sendError(res, ErrorResponses.unauthorized('You can only delete your own configs'));
    }

    // Check delete constraints using service
    const constraintError = await service.checkDeleteConstraints(configId);
    if (constraintError !== null) {
      return sendError(res, ErrorResponses.validationError(constraintError));
    }

    // Delete using service (handles cache invalidation)
    await service.delete(configId);

    logger.info({ discordUserId, configId, name: config.name }, 'Deleted config');
    sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
  };
}

// --- Main Route Factory ---

export function createLlmConfigRoutes(
  prisma: PrismaClient,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService,
  modelCache?: OpenRouterModelCache,
  cascadeResolver?: ConfigCascadeResolver
): Router {
  const router = Router();

  // Instantiate services with dependencies
  const service = new LlmConfigService(prisma, llmConfigCacheInvalidation);
  const userService = getOrCreateUserService(prisma);

  router.get(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createListHandler(service, userService))
  );
  router.get(
    '/:id',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createGetHandler(service, userService, modelCache))
  );
  router.post(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createCreateHandler(service, userService, modelCache))
  );
  router.post(
    '/resolve',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createResolveHandler(prisma, cascadeResolver))
  );
  router.put(
    '/:id',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createUpdateHandler(service, userService, modelCache))
  );
  router.delete(
    '/:id',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createDeleteHandler(service, userService))
  );

  return router;
}
