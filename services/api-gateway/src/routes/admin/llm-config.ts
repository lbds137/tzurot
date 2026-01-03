/**
 * Admin LLM Config Routes
 * Owner-only endpoints for managing global LLM configurations
 *
 * Endpoints:
 * - GET /admin/llm-config - List all LLM configs
 * - POST /admin/llm-config - Create a global LLM config
 * - PUT /admin/llm-config/:id - Edit a global config
 * - PUT /admin/llm-config/:id/set-default - Set a config as system default
 * - PUT /admin/llm-config/:id/set-free-default - Set a config as free tier default
 * - DELETE /admin/llm-config/:id - Delete a global config
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  type LlmConfigCacheInvalidationService,
  generateLlmConfigUuid,
} from '@tzurot/common-types';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { Request } from 'express';

const logger = createLogger('admin-llm-config');

/**
 * Request body for creating a global config
 */
interface CreateGlobalConfigBody {
  name: string;
  description?: string;
  provider?: string;
  model: string;
  visionModel?: string;
  temperature?: number;
  maxReferencedMessages?: number;
}

export function createAdminLlmConfigRoutes(
  prisma: PrismaClient,
  llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService
): Router {
  const router = Router();

  /**
   * GET /admin/llm-config
   * List all LLM configs (global and user-owned)
   */
  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      // Get all configs
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
        ownerInfo: c.owner ? { discordId: c.owner.discordId, username: c.owner.username } : null,
        owner: undefined,
      }));

      logger.info({ count: configs.length }, '[AdminLlmConfig] Listed all configs');

      sendCustomSuccess(res, { configs: formattedConfigs }, StatusCodes.OK);
    })
  );

  /**
   * POST /admin/llm-config
   * Create a new global LLM config
   */
  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as CreateGlobalConfigBody;

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

      // Check for duplicate name among global configs
      const existing = await prisma.llmConfig.findFirst({
        where: {
          isGlobal: true,
          name: body.name.trim(),
        },
      });

      if (existing !== null) {
        return sendError(
          res,
          ErrorResponses.validationError(`A global config named "${body.name}" already exists`)
        );
      }

      // Create the global config
      const config = await prisma.llmConfig.create({
        data: {
          id: generateLlmConfigUuid(body.name.trim()),
          name: body.name.trim(),
          description: body.description ?? null,
          ownerId: null, // Global configs have no owner
          isGlobal: true,
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
        { configId: config.id, name: config.name },
        '[AdminLlmConfig] Created global config'
      );

      sendCustomSuccess(res, { config }, StatusCodes.CREATED);
    })
  );

  /**
   * PUT /admin/llm-config/:id
   * Edit a global config
   */
  router.put(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const configId = req.params.id;
      const body = req.body as Partial<CreateGlobalConfigBody>;

      // Find the config
      const existing = await prisma.llmConfig.findUnique({
        where: { id: configId },
        select: { id: true, name: true, isGlobal: true },
      });

      if (existing === null) {
        return sendError(res, ErrorResponses.notFound('Config not found'));
      }

      if (!existing.isGlobal) {
        return sendError(res, ErrorResponses.validationError('Can only edit global configs'));
      }

      // Build update data (only update provided fields)
      const updateData: Record<string, unknown> = {};
      if (body.name !== undefined && body.name.trim().length > 0) {
        if (body.name.length > 100) {
          return sendError(
            res,
            ErrorResponses.validationError('name must be 100 characters or less')
          );
        }
        // Check for duplicate name (excluding current config)
        const duplicate = await prisma.llmConfig.findFirst({
          where: {
            isGlobal: true,
            name: body.name.trim(),
            id: { not: configId },
          },
        });
        if (duplicate !== null) {
          return sendError(
            res,
            ErrorResponses.validationError(`A global config named "${body.name}" already exists`)
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
      if (body.model !== undefined && body.model.trim().length > 0) {
        updateData.model = body.model.trim();
      }
      if (body.visionModel !== undefined) {
        updateData.visionModel = body.visionModel;
      }
      if (body.temperature !== undefined) {
        updateData.temperature = body.temperature;
      }
      if (body.maxReferencedMessages !== undefined) {
        updateData.maxReferencedMessages = body.maxReferencedMessages;
      }

      if (Object.keys(updateData).length === 0) {
        return sendError(res, ErrorResponses.validationError('No fields to update'));
      }

      // Update the config
      const config = await prisma.llmConfig.update({
        where: { id: configId },
        data: updateData,
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
        { configId, name: config.name, updates: Object.keys(updateData) },
        '[AdminLlmConfig] Updated global config'
      );

      // Invalidate LLM config caches (global config may affect any user)
      if (llmConfigCacheInvalidation) {
        try {
          await llmConfigCacheInvalidation.invalidateAll();
          logger.debug({ configId }, '[AdminLlmConfig] Invalidated LLM config caches');
        } catch (err) {
          // Log but don't fail the request - cache will expire naturally
          logger.error({ err, configId }, '[AdminLlmConfig] Failed to invalidate caches');
        }
      }

      sendCustomSuccess(res, { config }, StatusCodes.OK);
    })
  );

  /**
   * PUT /admin/llm-config/:id/set-default
   * Set a config as the system default
   */
  router.put(
    '/:id/set-default',
    asyncHandler(async (req: Request, res: Response) => {
      const configId = req.params.id;

      // Find the config
      const config = await prisma.llmConfig.findUnique({
        where: { id: configId },
        select: { id: true, name: true, isGlobal: true },
      });

      if (config === null) {
        return sendError(res, ErrorResponses.notFound('Config not found'));
      }

      // Only global configs can be set as default
      if (!config.isGlobal) {
        return sendError(
          res,
          ErrorResponses.validationError('Only global configs can be set as system default')
        );
      }

      // Atomically clear existing default and set new one (prevents race condition)
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

      // Invalidate LLM config caches (default config affects fallback resolution)
      if (llmConfigCacheInvalidation) {
        try {
          await llmConfigCacheInvalidation.invalidateAll();
          logger.debug({ configId }, '[AdminLlmConfig] Invalidated LLM config caches');
        } catch (err) {
          // Log but don't fail the request - cache will expire naturally
          logger.error({ err, configId }, '[AdminLlmConfig] Failed to invalidate caches');
        }
      }

      sendCustomSuccess(res, { success: true, configName: config.name }, StatusCodes.OK);
    })
  );

  /**
   * PUT /admin/llm-config/:id/set-free-default
   * Set a config as the free tier default (for guest users without API keys)
   */
  router.put(
    '/:id/set-free-default',
    asyncHandler(async (req: Request, res: Response) => {
      const configId = req.params.id;

      // Find the config
      const config = await prisma.llmConfig.findUnique({
        where: { id: configId },
        select: { id: true, name: true, isGlobal: true },
      });

      if (config === null) {
        return sendError(res, ErrorResponses.notFound('Config not found'));
      }

      // Only global configs can be set as free default
      if (!config.isGlobal) {
        return sendError(
          res,
          ErrorResponses.validationError('Only global configs can be set as free tier default')
        );
      }

      // Atomically clear existing free default and set new one (prevents race condition)
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

      // Invalidate LLM config caches (free default affects guest resolution)
      if (llmConfigCacheInvalidation) {
        try {
          await llmConfigCacheInvalidation.invalidateAll();
          logger.debug({ configId }, '[AdminLlmConfig] Invalidated LLM config caches');
        } catch (err) {
          // Log but don't fail the request - cache will expire naturally
          logger.error({ err, configId }, '[AdminLlmConfig] Failed to invalidate caches');
        }
      }

      sendCustomSuccess(res, { success: true, configName: config.name }, StatusCodes.OK);
    })
  );

  /**
   * DELETE /admin/llm-config/:id
   * Delete a global config (cannot delete if it's the default)
   */
  router.delete(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const configId = req.params.id;

      // Find the config
      const config = await prisma.llmConfig.findUnique({
        where: { id: configId },
        select: { id: true, name: true, isGlobal: true, isDefault: true },
      });

      if (config === null) {
        return sendError(res, ErrorResponses.notFound('Config not found'));
      }

      // Cannot delete non-global configs through admin
      if (!config.isGlobal) {
        return sendError(res, ErrorResponses.validationError('Can only delete global configs'));
      }

      // Cannot delete the default config
      if (config.isDefault) {
        return sendError(
          res,
          ErrorResponses.validationError('Cannot delete the system default config')
        );
      }

      // Use transaction to prevent race condition: usage could be added between check and delete
      // Note: Early validation (isGlobal, isDefault) is outside transaction since those are
      // properties of the config itself, not external references that could change concurrently
      const deleteResult = await prisma.$transaction(async tx => {
        // Check if in use by any personality (inside transaction)
        const personalityCount = await tx.personalityDefaultConfig.count({
          where: { llmConfigId: configId },
        });

        if (personalityCount > 0) {
          return {
            success: false,
            error: `Cannot delete: config is used as default by ${personalityCount} personality(ies)`,
          };
        }

        // Check if in use by any user override (inside transaction)
        const userOverrideCount = await tx.userPersonalityConfig.count({
          where: { llmConfigId: configId },
        });

        if (userOverrideCount > 0) {
          return {
            success: false,
            error: `Cannot delete: config is used by ${userOverrideCount} user override(s)`,
          };
        }

        // Delete (atomically after checks pass)
        await tx.llmConfig.delete({
          where: { id: configId },
        });

        return { success: true };
      });

      if (!deleteResult.success) {
        return sendError(
          res,
          ErrorResponses.validationError(deleteResult.error ?? 'Delete failed')
        );
      }

      logger.info({ configId, name: config.name }, '[AdminLlmConfig] Deleted global config');

      sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
    })
  );

  return router;
}
