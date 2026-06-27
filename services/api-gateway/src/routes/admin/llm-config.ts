/**
 * Admin LLM Config Routes
 * Owner-only endpoints for managing global LLM configurations
 *
 * Endpoints:
 * - GET /admin/llm-config - List all LLM configs
 * - GET /admin/llm-config/:id - Get single config with full params
 * - POST /admin/llm-config - Create a global LLM config
 * - PUT /admin/llm-config/:id - Edit a global config
 * - PUT /admin/llm-config/:id/set-default - Set a config as system default
 * - PUT /admin/llm-config/:id/set-free-default - Set a config as free tier default
 * - DELETE /admin/llm-config/:id - Delete a global config
 */

import { Router, type Response, type Request, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  // Shared schemas from common-types - single source of truth
  LlmConfigCreateSchema,
  LlmConfigUpdateSchema,
} from '@tzurot/common-types';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getRequiredParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../types.js';
import { LlmConfigService } from '../../services/LlmConfigService.js';
import type { OpenRouterModelCache } from '../../services/OpenRouterModelCache.js';
import { enrichWithModelContext } from '../../utils/modelValidation.js';
import { validateLlmConfigModelFields } from '../../utils/llmConfigValidation.js';
import {
  parseBodyOrSendError,
  findGlobalConfigOrSendError,
  findAdminUserOrSendError,
  ensureNoNameCollision,
  shapeDeleteResponse,
  withAdminOwnership,
} from '../../utils/configRouteHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('admin-llm-config');

/** Resource name for ErrorResponses.notFound() */
const CONFIG_RESOURCE = 'Config';
/** Plural label used in the isGlobal-guard messages. */
const CONFIG_LABEL = 'configs';

// --- Handler Factories ---

function createListHandler(service: LlmConfigService) {
  return async (_req: Request, res: Response) => {
    const configs = (await service.list({ type: 'GLOBAL' })).map(raw =>
      withAdminOwnership(service.formatConfigSummary(raw))
    );

    logger.info({ count: configs.length }, 'Listed all configs');
    sendCustomSuccess(res, { configs }, StatusCodes.OK);
  };
}

function createGetHandler(service: LlmConfigService, modelCache?: OpenRouterModelCache) {
  return async (req: Request, res: Response) => {
    const configId = getRequiredParam(req.params.id, 'id');

    const config = await service.getById(configId);
    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_RESOURCE));
    }

    const formatted = service.formatConfigDetail(config);
    await enrichWithModelContext(formatted, config.model, modelCache);

    logger.debug({ configId }, 'Fetched config');
    sendCustomSuccess(res, { config: withAdminOwnership(formatted) }, StatusCodes.OK);
  };
}

function createCreateConfigHandler(
  service: LlmConfigService,
  prisma: PrismaClient,
  modelCache?: OpenRouterModelCache
) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const body = parseBodyOrSendError(res, LlmConfigCreateSchema, req.body);
    if (body === null) {
      return;
    }

    // Global presets have no specific saving user — pass hasZaiCodingKey:true so
    // z.ai-catalog models (incl. z.ai-only ones like glm-5.2) are validatable as
    // global configs. Users with a z.ai key promote at runtime; users without
    // one fall through to OpenRouter.
    if (!(await validateLlmConfigModelFields({ res, modelCache, body, hasZaiCodingKey: true }))) {
      return;
    }

    const adminUser = await findAdminUserOrSendError(res, prisma, discordUserId, logger);
    if (adminUser === null) {
      return;
    }

    if (
      !(await ensureNoNameCollision(res, service, {
        name: body.name,
        scope: { type: 'GLOBAL' },
        formatCollisionMessage: n => `A global config named "${n}" already exists`,
      }))
    ) {
      return;
    }

    const config = await service.create({ type: 'GLOBAL' }, body, adminUser.id);
    const formatted = service.formatConfigDetail(config);
    await enrichWithModelContext(formatted, config.model, modelCache);

    logger.info({ configId: config.id, name: config.name }, 'Created global config');
    sendCustomSuccess(res, { config: withAdminOwnership(formatted) }, StatusCodes.CREATED);
  };
}

function createEditConfigHandler(
  service: LlmConfigService,
  prisma: PrismaClient,
  modelCache?: OpenRouterModelCache
) {
  return async (req: Request, res: Response) => {
    const configId = getRequiredParam(req.params.id, 'id');

    const body = parseBodyOrSendError(res, LlmConfigUpdateSchema, req.body);
    if (body === null) {
      return;
    }

    if (
      !(await validateLlmConfigModelFields({
        res,
        modelCache,
        body,
        fallback: { service, configId: configId },
        hasZaiCodingKey: true,
      }))
    ) {
      return;
    }

    const existing = await findGlobalConfigOrSendError(
      res,
      () =>
        prisma.llmConfig.findUnique({
          where: { id: configId },
          select: { id: true, name: true, isGlobal: true, kind: true },
        }),
      {
        notFoundResource: CONFIG_RESOURCE,
        resourceLabel: CONFIG_LABEL,
        operation: 'edit',
        requireKind: 'text',
      }
    );
    if (existing === null) {
      return;
    }

    if (
      body.name !== undefined &&
      !(await ensureNoNameCollision(res, service, {
        name: body.name,
        scope: { type: 'GLOBAL' },
        excludeId: configId,
        formatCollisionMessage: n => `A global config named "${n}" already exists`,
      }))
    ) {
      return;
    }

    if (Object.keys(body).length === 0) {
      return sendError(res, ErrorResponses.validationError('No fields to update'));
    }

    const config = await service.update(configId, body);
    const formatted = service.formatConfigDetail(config);
    await enrichWithModelContext(formatted, config.model, modelCache);

    logger.info(
      { configId, name: config.name, updates: Object.keys(body) },
      'Updated global config'
    );
    sendCustomSuccess(res, { config: withAdminOwnership(formatted) }, StatusCodes.OK);
  };
}

function createSetDefaultHandler(service: LlmConfigService, prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const configId = getRequiredParam(req.params.id, 'id');

    const config = await findGlobalConfigOrSendError(
      res,
      () =>
        prisma.llmConfig.findUnique({
          where: { id: configId },
          select: { id: true, name: true, isGlobal: true, kind: true },
        }),
      {
        notFoundResource: CONFIG_RESOURCE,
        resourceLabel: CONFIG_LABEL,
        operation: 'set as system default',
        requireKind: 'text',
      }
    );
    if (config === null) {
      return;
    }

    await service.setAsDefault(configId);

    logger.info({ configId, name: config.name }, 'Set as system default');
    sendCustomSuccess(res, { success: true, configName: config.name }, StatusCodes.OK);
  };
}

function createSetFreeDefaultHandler(service: LlmConfigService, prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const configId = getRequiredParam(req.params.id, 'id');

    const config = await findGlobalConfigOrSendError(
      res,
      () =>
        prisma.llmConfig.findUnique({
          where: { id: configId },
          select: { id: true, name: true, isGlobal: true, model: true, kind: true },
        }),
      {
        notFoundResource: CONFIG_RESOURCE,
        resourceLabel: CONFIG_LABEL,
        operation: 'set as free tier default',
        requireKind: 'text',
      }
    );
    if (config === null) {
      return;
    }

    if (!config.model.endsWith(':free')) {
      return sendError(
        res,
        ErrorResponses.validationError(
          'Only presets using free models (model ID ending in :free) can be set as free tier default'
        )
      );
    }

    await service.setAsFreeDefault(configId);

    logger.info({ configId, name: config.name }, 'Set as free tier default');
    sendCustomSuccess(res, { success: true, configName: config.name }, StatusCodes.OK);
  };
}

function createDeleteConfigHandler(service: LlmConfigService, prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const configId = getRequiredParam(req.params.id, 'id');

    const config = await findGlobalConfigOrSendError(
      res,
      () =>
        prisma.llmConfig.findUnique({
          where: { id: configId },
          select: {
            id: true,
            name: true,
            isGlobal: true,
            isDefault: true,
            isFreeDefault: true,
            kind: true,
          },
        }),
      {
        notFoundResource: CONFIG_RESOURCE,
        resourceLabel: CONFIG_LABEL,
        operation: 'delete',
        requireKind: 'text',
      }
    );
    if (config === null) {
      return;
    }

    if (config.isDefault) {
      return sendError(
        res,
        ErrorResponses.validationError('Cannot delete the system default config')
      );
    }
    // Same hard-block shape as isDefault: deleting the free-tier default
    // would silently break LLM access for all guest users until an admin
    // sets a new one. Force the admin to promote a replacement first.
    if (config.isFreeDefault) {
      return sendError(
        res,
        ErrorResponses.validationError('Cannot delete the free tier default config')
      );
    }

    // Check delete constraints. Blocker stops the delete; warning informs
    // the admin (e.g., "N users will have their personal default reset").
    // When BOTH are non-null, blocker wins and warning is dropped: the admin
    // can't proceed until they reassign anyway, so showing both at once is
    // informational not actionable — warning surfaces on the retry after
    // the blocker is cleared.
    const { blocker, warning } = await service.checkDeleteConstraints(configId);
    if (blocker !== null) {
      return sendError(res, ErrorResponses.validationError(blocker));
    }

    await service.delete(configId);

    const { responseBody, logFields } = shapeDeleteResponse(warning, {
      configId,
      name: config.name,
    });

    logger.info(logFields, 'Deleted global config');
    sendCustomSuccess(res, responseBody, StatusCodes.OK);
  };
}

// --- Exported handler factories (each constructs its own service from deps) ---

function buildService(deps: RouteDeps): LlmConfigService {
  return new LlmConfigService(deps.prisma, deps.llmConfigCacheInvalidation);
}

export const handleListGlobalLlmConfigs = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createListHandler(buildService(deps)));

export const handleGetGlobalLlmConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createGetHandler(buildService(deps), deps.modelCache));

export const handleCreateGlobalLlmConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createCreateConfigHandler(buildService(deps), deps.prisma, deps.modelCache));

export const handleUpdateGlobalLlmConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createEditConfigHandler(buildService(deps), deps.prisma, deps.modelCache));

export const handleSetGlobalLlmConfigDefault = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createSetDefaultHandler(buildService(deps), deps.prisma));

export const handleSetGlobalLlmConfigFreeDefault = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createSetFreeDefaultHandler(buildService(deps), deps.prisma));

export const handleDeleteGlobalLlmConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createDeleteConfigHandler(buildService(deps), deps.prisma));

// --- Main Route Factory ---

export function createAdminLlmConfigRoutes(deps: RouteDeps): Router {
  const router = Router();

  router.get('/', requireOwnerAuth(), handleListGlobalLlmConfigs(deps));
  router.get('/:id', requireOwnerAuth(), handleGetGlobalLlmConfig(deps));
  router.post('/', requireOwnerAuth(), handleCreateGlobalLlmConfig(deps));
  router.put('/:id', requireOwnerAuth(), handleUpdateGlobalLlmConfig(deps));
  router.put('/:id/set-default', requireOwnerAuth(), handleSetGlobalLlmConfigDefault(deps));
  router.put(
    '/:id/set-free-default',
    requireOwnerAuth(),
    handleSetGlobalLlmConfigFreeDefault(deps)
  );
  router.delete('/:id', requireOwnerAuth(), handleDeleteGlobalLlmConfig(deps));

  return router;
}
