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
  generateLlmConfigUuid,
  safeValidateAdvancedParams,
  AI_DEFAULTS,
  MESSAGE_LIMITS,
  // Shared schemas from common-types - single source of truth
  LlmConfigCreateSchema,
  LlmConfigUpdateSchema,
  LLM_CONFIG_DETAIL_SELECT,
  type LlmConfigUpdateInput,
} from '@tzurot/common-types';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('admin-llm-config');

/** Repeated error message for missing configs */
const CONFIG_NOT_FOUND = 'Config not found';

// Schemas and SELECT constants are imported from @tzurot/common-types (single source of truth)
// - LlmConfigCreateSchema: Zod schema for create validation
// - LlmConfigUpdateSchema: Zod schema for update validation
// - LLM_CONFIG_DETAIL_SELECT: Prisma select for detail queries

// --- Handler Factories ---

function createListHandler(prisma: PrismaClient) {
  return async (_req: Request, res: Response) => {
    const configs = await prisma.llmConfig.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        provider: true,
        model: true,
        visionModel: true,
        isGlobal: true,
        isDefault: true,
        isFreeDefault: true,
        ownerId: true,
        owner: {
          select: { discordId: true, username: true },
        },
      },
      orderBy: [
        { isDefault: 'desc' },
        { isFreeDefault: 'desc' },
        { isGlobal: 'desc' },
        { name: 'asc' },
      ],
    });

    const formattedConfigs = configs.map(c => ({
      ...c,
      ownerInfo: { discordId: c.owner.discordId, username: c.owner.username },
      owner: undefined,
    }));

    logger.info({ count: configs.length }, '[AdminLlmConfig] Listed all configs');
    sendCustomSuccess(res, { configs: formattedConfigs }, StatusCodes.OK);
  };
}

function createGetHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const configId = getParam(req.params.id);

    const config = await prisma.llmConfig.findUnique({
      where: { id: configId },
      select: LLM_CONFIG_DETAIL_SELECT,
    });

    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_NOT_FOUND));
    }

    // Parse advancedParameters with validation
    const params = safeValidateAdvancedParams(config.advancedParameters) ?? {};

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
      isFreeDefault: config.isFreeDefault,
      maxReferencedMessages: config.maxReferencedMessages,
      // Memory settings (now aligned with user routes)
      memoryScoreThreshold:
        config.memoryScoreThreshold !== null && typeof config.memoryScoreThreshold === 'object'
          ? (config.memoryScoreThreshold as { toNumber: () => number }).toNumber()
          : config.memoryScoreThreshold,
      memoryLimit: config.memoryLimit,
      contextWindowTokens: config.contextWindowTokens,
      // Context settings
      maxMessages: config.maxMessages,
      maxAge: config.maxAge,
      maxImages: config.maxImages,
      params,
    };

    logger.debug({ configId }, '[AdminLlmConfig] Fetched config');
    sendCustomSuccess(res, { config: response }, StatusCodes.OK);
  };
}

function createCreateConfigHandler(prisma: PrismaClient) {
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
    const existing = await prisma.llmConfig.findFirst({
      where: { isGlobal: true, name: body.name.trim() },
    });

    if (existing !== null) {
      return sendError(
        res,
        ErrorResponses.validationError(`A global config named "${body.name}" already exists`)
      );
    }

    const config = await prisma.llmConfig.create({
      data: {
        id: generateLlmConfigUuid(body.name.trim()),
        name: body.name.trim(),
        description: body.description ?? null,
        ownerId: adminUser.id,
        isGlobal: true,
        isDefault: false,
        provider: body.provider ?? 'openrouter',
        model: body.model.trim(),
        visionModel: body.visionModel ?? null,
        maxReferencedMessages: body.maxReferencedMessages ?? AI_DEFAULTS.MAX_REFERENCED_MESSAGES,
        advancedParameters: body.advancedParameters ?? undefined,
        // Memory settings (now aligned with user routes)
        memoryScoreThreshold: body.memoryScoreThreshold ?? AI_DEFAULTS.MEMORY_SCORE_THRESHOLD,
        memoryLimit: body.memoryLimit ?? AI_DEFAULTS.MEMORY_LIMIT,
        contextWindowTokens: body.contextWindowTokens ?? AI_DEFAULTS.CONTEXT_WINDOW_TOKENS,
        // Context settings
        maxMessages: body.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
        maxAge: body.maxAge ?? null,
        maxImages: body.maxImages ?? MESSAGE_LIMITS.DEFAULT_MAX_IMAGES,
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
      { configId: config.id, name: config.name },
      '[AdminLlmConfig] Created global config'
    );
    sendCustomSuccess(res, { config }, StatusCodes.CREATED);
  };
}

function createEditConfigHandler(
  prisma: PrismaClient,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService
) {
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

    const updateResult = await buildUpdateData(prisma, configId, body);
    if ('error' in updateResult) {
      return sendError(res, updateResult.error);
    }

    if (Object.keys(updateResult.data).length === 0) {
      return sendError(res, ErrorResponses.validationError('No fields to update'));
    }

    const config = await prisma.llmConfig.update({
      where: { id: configId },
      data: updateResult.data,
      select: LLM_CONFIG_DETAIL_SELECT,
    });

    // Parse advancedParameters for response
    const params = safeValidateAdvancedParams(config.advancedParameters) ?? {};

    const response = {
      id: config.id,
      name: config.name,
      description: config.description,
      provider: config.provider,
      model: config.model,
      visionModel: config.visionModel,
      isGlobal: config.isGlobal,
      isDefault: config.isDefault,
      isFreeDefault: config.isFreeDefault,
      maxReferencedMessages: config.maxReferencedMessages,
      // Memory settings (now aligned with user routes)
      memoryScoreThreshold:
        config.memoryScoreThreshold !== null && typeof config.memoryScoreThreshold === 'object'
          ? (config.memoryScoreThreshold as { toNumber: () => number }).toNumber()
          : config.memoryScoreThreshold,
      memoryLimit: config.memoryLimit,
      contextWindowTokens: config.contextWindowTokens,
      // Context settings
      maxMessages: config.maxMessages,
      maxAge: config.maxAge,
      maxImages: config.maxImages,
      params,
    };

    logger.info(
      { configId, name: config.name, updates: Object.keys(updateResult.data) },
      '[AdminLlmConfig] Updated global config'
    );

    await invalidateCacheSafely(llmConfigCacheInvalidation, configId, 'Updated global config');
    sendCustomSuccess(res, { config: response }, StatusCodes.OK);
  };
}

function createSetDefaultHandler(
  prisma: PrismaClient,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService
) {
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

    await prisma.$transaction(async tx => {
      await tx.llmConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
      await tx.llmConfig.update({
        where: { id: configId },
        data: { isDefault: true },
      });
    });

    logger.info({ configId, name: config.name }, '[AdminLlmConfig] Set as system default');
    await invalidateCacheSafely(llmConfigCacheInvalidation, configId, 'Set as system default');
    sendCustomSuccess(res, { success: true, configName: config.name }, StatusCodes.OK);
  };
}

function createSetFreeDefaultHandler(
  prisma: PrismaClient,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService
) {
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

    await prisma.$transaction(async tx => {
      await tx.llmConfig.updateMany({
        where: { isFreeDefault: true },
        data: { isFreeDefault: false },
      });
      await tx.llmConfig.update({
        where: { id: configId },
        data: { isFreeDefault: true },
      });
    });

    logger.info({ configId, name: config.name }, '[AdminLlmConfig] Set as free tier default');
    await invalidateCacheSafely(llmConfigCacheInvalidation, configId, 'Set as free tier default');
    sendCustomSuccess(res, { success: true, configName: config.name }, StatusCodes.OK);
  };
}

function createDeleteConfigHandler(prisma: PrismaClient) {
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

    const deleteResult = await executeDeleteTransaction(prisma, configId);
    if (!deleteResult.success) {
      return sendError(res, ErrorResponses.validationError(deleteResult.error ?? 'Delete failed'));
    }

    logger.info({ configId, name: config.name }, '[AdminLlmConfig] Deleted global config');
    sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
  };
}

// --- Helper Functions ---

type BuildUpdateResult =
  | { data: Record<string, unknown> }
  | { error: ReturnType<typeof ErrorResponses.validationError> };

/** Fields that can be directly copied without validation */
const SIMPLE_COPY_FIELDS = [
  'description',
  'provider',
  'visionModel',
  'maxReferencedMessages',
  // Memory settings (now aligned with user routes)
  'memoryScoreThreshold',
  'memoryLimit',
  'contextWindowTokens',
  // Context settings
  'maxMessages',
  'maxAge',
  'maxImages',
] as const;

/**
 * Validate and prepare name field for update
 * Returns error response if validation fails, trimmed name otherwise
 */
async function validateNameUpdate(
  prisma: PrismaClient,
  name: string,
  excludeConfigId: string | undefined
): Promise<{ error: ReturnType<typeof ErrorResponses.validationError> } | { name: string }> {
  if (name.length > 100) {
    return { error: ErrorResponses.validationError('name must be 100 characters or less') };
  }
  const duplicate = await prisma.llmConfig.findFirst({
    where: { isGlobal: true, name: name.trim(), id: { not: excludeConfigId } },
  });
  if (duplicate !== null) {
    return {
      error: ErrorResponses.validationError(`A global config named "${name}" already exists`),
    };
  }
  return { name: name.trim() };
}

async function buildUpdateData(
  prisma: PrismaClient,
  configId: string | undefined,
  body: LlmConfigUpdateInput
): Promise<BuildUpdateResult> {
  const updateData: Record<string, unknown> = {};

  // Validate name if provided
  if (body.name !== undefined && body.name.trim().length > 0) {
    const nameResult = await validateNameUpdate(prisma, body.name, configId);
    if ('error' in nameResult) {
      return nameResult;
    }
    updateData.name = nameResult.name;
  }

  // Copy simple fields that don't need validation
  for (const field of SIMPLE_COPY_FIELDS) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  // Handle model with trimming
  if (body.model !== undefined && body.model.trim().length > 0) {
    updateData.model = body.model.trim();
  }

  // Validate advancedParameters if provided
  if (body.advancedParameters !== undefined) {
    const validated = safeValidateAdvancedParams(body.advancedParameters);
    if (validated === null) {
      return { error: ErrorResponses.validationError('Invalid advancedParameters') };
    }
    updateData.advancedParameters = body.advancedParameters;
  }

  return { data: updateData };
}

async function executeDeleteTransaction(
  prisma: PrismaClient,
  configId: string | undefined
): Promise<{ success: boolean; error?: string }> {
  return prisma.$transaction(async tx => {
    const personalityCount = await tx.personalityDefaultConfig.count({
      where: { llmConfigId: configId },
    });
    if (personalityCount > 0) {
      return {
        success: false,
        error: `Cannot delete: config is used as default by ${personalityCount} personality(ies)`,
      };
    }

    const userOverrideCount = await tx.userPersonalityConfig.count({
      where: { llmConfigId: configId },
    });
    if (userOverrideCount > 0) {
      return {
        success: false,
        error: `Cannot delete: config is used by ${userOverrideCount} user override(s)`,
      };
    }

    await tx.llmConfig.delete({ where: { id: configId } });
    return { success: true };
  });
}

async function invalidateCacheSafely(
  llmConfigCacheInvalidation: LlmConfigCacheInvalidationService | undefined,
  configId: string | undefined,
  operation: string
): Promise<void> {
  if (!llmConfigCacheInvalidation) {
    return;
  }

  try {
    await llmConfigCacheInvalidation.invalidateAll();
    logger.debug(
      { configId },
      `[AdminLlmConfig] Invalidated LLM config caches after: ${operation}`
    );
  } catch (err) {
    logger.error({ err, configId }, '[AdminLlmConfig] Failed to invalidate caches');
  }
}

// --- Main Route Factory ---

export function createAdminLlmConfigRoutes(
  prisma: PrismaClient,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService
): Router {
  const router = Router();

  router.get('/', asyncHandler(createListHandler(prisma)));
  router.get('/:id', asyncHandler(createGetHandler(prisma)));
  router.post('/', asyncHandler(createCreateConfigHandler(prisma)));
  router.put('/:id', asyncHandler(createEditConfigHandler(prisma, llmConfigCacheInvalidation)));
  router.put(
    '/:id/set-default',
    asyncHandler(createSetDefaultHandler(prisma, llmConfigCacheInvalidation))
  );
  router.put(
    '/:id/set-free-default',
    asyncHandler(createSetFreeDefaultHandler(prisma, llmConfigCacheInvalidation))
  );
  router.delete('/:id', asyncHandler(createDeleteConfigHandler(prisma)));

  return router;
}
