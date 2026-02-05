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

import { Router, type Response, type Request } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  type LlmConfigCacheInvalidationService,
  // Shared schemas from common-types - single source of truth
  LlmConfigCreateSchema,
  LlmConfigUpdateSchema,
} from '@tzurot/common-types';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../types.js';
import { LlmConfigService } from '../../services/LlmConfigService.js';

const logger = createLogger('admin-llm-config');

/** Repeated error message for missing configs */
const CONFIG_NOT_FOUND = 'Config not found';

// --- Handler Factories ---

function createListHandler(service: LlmConfigService) {
  return async (_req: Request, res: Response) => {
    const configs = await service.list({ type: 'GLOBAL' });

    logger.info({ count: configs.length }, '[AdminLlmConfig] Listed all configs');
    sendCustomSuccess(res, { configs }, StatusCodes.OK);
  };
}

function createGetHandler(service: LlmConfigService) {
  return async (req: Request, res: Response) => {
    const configId = getParam(req.params.id);

    const config = await service.getById(configId ?? '');
    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_NOT_FOUND));
    }

    const response = service.formatConfigDetail(config);

    logger.debug({ configId }, '[AdminLlmConfig] Fetched config');
    sendCustomSuccess(res, { config: response }, StatusCodes.OK);
  };
}

function createCreateConfigHandler(service: LlmConfigService, prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    // Validate request body with shared Zod schema from common-types
    const parseResult = LlmConfigCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      const path = firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ` : '';
      return sendError(res, ErrorResponses.validationError(`${path}${firstIssue.message}`));
    }
    const body = parseResult.data;

    // Get admin user's internal ID for ownership
    const adminUser = await prisma.user.findUnique({
      where: { discordId: discordUserId },
      select: { id: true },
    });

    if (adminUser === null) {
      logger.warn({ discordUserId }, 'Admin user not found in database');
      return sendError(res, ErrorResponses.unauthorized('Admin user not found in database'));
    }

    // Check for duplicate name among global configs
    const nameCheck = await service.checkNameExists(body.name, { type: 'GLOBAL' });
    if (nameCheck.exists) {
      return sendError(
        res,
        ErrorResponses.validationError(`A global config named "${body.name}" already exists`)
      );
    }

    const config = await service.create({ type: 'GLOBAL' }, body, adminUser.id);
    const response = service.formatConfigDetail(config);

    logger.info(
      { configId: config.id, name: config.name },
      '[AdminLlmConfig] Created global config'
    );
    sendCustomSuccess(res, { config: response }, StatusCodes.CREATED);
  };
}

function createEditConfigHandler(service: LlmConfigService, prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const configId = getParam(req.params.id);

    // Validate request body with shared Zod schema from common-types
    const parseResult = LlmConfigUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      const path = firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ` : '';
      return sendError(res, ErrorResponses.validationError(`${path}${firstIssue.message}`));
    }
    const body = parseResult.data;

    const existing = await prisma.llmConfig.findUnique({
      where: { id: configId },
      select: { id: true, name: true, isGlobal: true },
    });

    if (existing === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_NOT_FOUND));
    }
    if (!existing.isGlobal) {
      return sendError(res, ErrorResponses.validationError('Can only edit global configs'));
    }

    // Check for duplicate name if name is being changed
    if (body.name !== undefined) {
      const nameCheck = await service.checkNameExists(body.name, { type: 'GLOBAL' }, configId);
      if (nameCheck.exists) {
        return sendError(
          res,
          ErrorResponses.validationError(`A global config named "${body.name}" already exists`)
        );
      }
    }

    if (Object.keys(body).length === 0) {
      return sendError(res, ErrorResponses.validationError('No fields to update'));
    }

    const config = await service.update(configId ?? '', body);
    const response = service.formatConfigDetail(config);

    logger.info(
      { configId, name: config.name, updates: Object.keys(body) },
      '[AdminLlmConfig] Updated global config'
    );
    sendCustomSuccess(res, { config: response }, StatusCodes.OK);
  };
}

function createSetDefaultHandler(service: LlmConfigService, prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const configId = getParam(req.params.id);

    const config = await prisma.llmConfig.findUnique({
      where: { id: configId },
      select: { id: true, name: true, isGlobal: true },
    });

    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_NOT_FOUND));
    }
    if (!config.isGlobal) {
      return sendError(
        res,
        ErrorResponses.validationError('Only global configs can be set as system default')
      );
    }

    await service.setAsDefault(configId ?? '');

    logger.info({ configId, name: config.name }, '[AdminLlmConfig] Set as system default');
    sendCustomSuccess(res, { success: true, configName: config.name }, StatusCodes.OK);
  };
}

function createSetFreeDefaultHandler(service: LlmConfigService, prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const configId = getParam(req.params.id);

    const config = await prisma.llmConfig.findUnique({
      where: { id: configId },
      select: { id: true, name: true, isGlobal: true, model: true },
    });

    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_NOT_FOUND));
    }
    if (!config.isGlobal) {
      return sendError(
        res,
        ErrorResponses.validationError('Only global configs can be set as free tier default')
      );
    }
    if (!config.model.endsWith(':free')) {
      return sendError(
        res,
        ErrorResponses.validationError(
          'Only presets using free models (model ID ending in :free) can be set as free tier default'
        )
      );
    }

    await service.setAsFreeDefault(configId ?? '');

    logger.info({ configId, name: config.name }, '[AdminLlmConfig] Set as free tier default');
    sendCustomSuccess(res, { success: true, configName: config.name }, StatusCodes.OK);
  };
}

function createDeleteConfigHandler(service: LlmConfigService, prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const configId = getParam(req.params.id);

    const config = await prisma.llmConfig.findUnique({
      where: { id: configId },
      select: { id: true, name: true, isGlobal: true, isDefault: true },
    });

    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_NOT_FOUND));
    }
    if (!config.isGlobal) {
      return sendError(res, ErrorResponses.validationError('Can only delete global configs'));
    }
    if (config.isDefault) {
      return sendError(
        res,
        ErrorResponses.validationError('Cannot delete the system default config')
      );
    }

    // Check delete constraints
    const constraintError = await service.checkDeleteConstraints(configId ?? '');
    if (constraintError !== null) {
      return sendError(res, ErrorResponses.validationError(constraintError));
    }

    await service.delete(configId ?? '');

    logger.info({ configId, name: config.name }, '[AdminLlmConfig] Deleted global config');
    sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
  };
}

// --- Main Route Factory ---

export function createAdminLlmConfigRoutes(
  prisma: PrismaClient,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService
): Router {
  const router = Router();

  // Instantiate service with dependencies
  const service = new LlmConfigService(prisma, llmConfigCacheInvalidation);

  router.get('/', asyncHandler(createListHandler(service)));
  router.get('/:id', asyncHandler(createGetHandler(service)));
  router.post('/', asyncHandler(createCreateConfigHandler(service, prisma)));
  router.put('/:id', asyncHandler(createEditConfigHandler(service, prisma)));
  router.put('/:id/set-default', asyncHandler(createSetDefaultHandler(service, prisma)));
  router.put('/:id/set-free-default', asyncHandler(createSetFreeDefaultHandler(service, prisma)));
  router.delete('/:id', asyncHandler(createDeleteConfigHandler(service, prisma)));

  return router;
}
