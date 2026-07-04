/**
 * Admin TTS Config Routes
 * Owner-only endpoints for managing global TTS configurations
 *
 * Endpoints:
 * - GET    /admin/tts-config                  - List all TTS configs
 * - GET    /admin/tts-config/:id              - Get single config detail
 * - POST   /admin/tts-config                  - Create a global TTS config
 * - PUT    /admin/tts-config/:id              - Edit a global config
 * - PUT    /admin/tts-config/:id/set-default  - Set a config as system default
 * - PUT    /admin/tts-config/:id/set-free-default - Set a config as free tier default
 * - DELETE /admin/tts-config/:id              - Delete a global config
 *
 * Mirrors `routes/admin/llm-config.ts` shape minus LLM-specific concerns
 * (no model-context enrichment, no model-fields validation).
 *
 * Free-tier default constraint: only `provider === 'self-hosted'` configs
 * may be marked as the free-tier default — paid BYOK providers
 * (`elevenlabs`, `mistral`) require user-supplied API keys, so they can't
 * serve guests. Mirrors the spirit of LLM's `:free` model suffix check
 * (LLM-specific OpenRouter convention) but applies the TTS-shaped invariant.
 */

import { Router, type Response, type Request, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  TtsConfigCreateSchema,
  TtsConfigUpdateSchema,
} from '@tzurot/common-types/schemas/api/tts-config';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { isSelfHostedTtsProvider } from '@tzurot/common-types/services/tts/TtsProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireOwnerAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getRequiredParam } from '../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../types.js';
import { TtsConfigService, TtsInvalidProviderError } from '../../services/TtsConfigService.js';
import {
  parseBodyOrSendError,
  findGlobalConfigOrSendError,
  findAdminUserOrSendError,
  ensureNoNameCollision,
  shapeDeleteResponse,
  withAdminOwnership,
} from '../../utils/configRouteHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('admin-tts-config');

const CONFIG_RESOURCE = 'TtsConfig';
/** Plural label used in the isGlobal-guard messages. */
const CONFIG_LABEL = 'TTS configs';

// --- Handler factories -----------------------------------------------------

function createListHandler(service: TtsConfigService) {
  return async (_req: Request, res: Response) => {
    const rawConfigs = await service.list({ type: 'GLOBAL' });
    // Apply formatConfigDetail so the list response shape matches the
    // single-detail endpoint (same admin client may call both; the user
    // routes maintain the same parity). The list select doesn't include
    // `advancedParameters`, so the formatter reads it as `null` →
    // `params: {}` for list rows. Detail endpoints surface populated
    // params from the wider DETAIL_SELECT.
    const configs = rawConfigs.map(c =>
      withAdminOwnership(service.formatConfigDetail({ ...c, advancedParameters: null }))
    );
    logger.info({ count: configs.length }, 'Listed all TTS configs');
    sendCustomSuccess(res, { configs }, StatusCodes.OK);
  };
}

function createGetHandler(service: TtsConfigService) {
  return async (req: Request, res: Response) => {
    const configId = getRequiredParam(req.params.id, 'id');
    const config = await service.getById(configId);
    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_RESOURCE));
    }
    const formatted = service.formatConfigDetail(config);
    logger.debug({ configId }, 'Fetched TTS config');
    sendCustomSuccess(res, { config: withAdminOwnership(formatted) }, StatusCodes.OK);
  };
}

function createCreateHandler(service: TtsConfigService, prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const discordUserId = req.userId;

    const body = parseBodyOrSendError(res, TtsConfigCreateSchema, req.body);
    if (body === null) {
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
        formatCollisionMessage: n => `A global TTS config named "${n}" already exists`,
      }))
    ) {
      return;
    }

    const config = await service.create({ type: 'GLOBAL' }, body, adminUser.id);
    const formatted = service.formatConfigDetail(config);

    logger.info(
      { configId: config.id, name: config.name, provider: config.provider },
      'Created global TTS config'
    );
    sendCustomSuccess(res, { config: withAdminOwnership(formatted) }, StatusCodes.CREATED);
  };
}

function createEditHandler(service: TtsConfigService, prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const configId = getRequiredParam(req.params.id, 'id');

    const body = parseBodyOrSendError(res, TtsConfigUpdateSchema, req.body);
    if (body === null) {
      return;
    }

    const existing = await findGlobalConfigOrSendError(
      res,
      () =>
        prisma.ttsConfig.findUnique({
          where: { id: configId },
          select: { id: true, name: true, isGlobal: true },
        }),
      { notFoundResource: CONFIG_RESOURCE, resourceLabel: CONFIG_LABEL, operation: 'edit' }
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
        formatCollisionMessage: n => `A global TTS config named "${n}" already exists`,
      }))
    ) {
      return;
    }

    if (Object.keys(body).length === 0) {
      return sendError(res, ErrorResponses.validationError('No fields to update'));
    }

    let config;
    try {
      config = await service.update(configId, body);
    } catch (err) {
      if (err instanceof TtsInvalidProviderError) {
        return sendError(
          res,
          ErrorResponses.validationError(
            `Invalid provider "${err.provider}" — must be one of self-hosted, elevenlabs, mistral`
          )
        );
      }
      throw err;
    }
    const formatted = service.formatConfigDetail(config);

    logger.info(
      { configId, name: config.name, updates: Object.keys(body) },
      'Updated global TTS config'
    );
    sendCustomSuccess(res, { config: withAdminOwnership(formatted) }, StatusCodes.OK);
  };
}

function createSetDefaultHandler(service: TtsConfigService, prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const configId = getRequiredParam(req.params.id, 'id');

    const config = await findGlobalConfigOrSendError(
      res,
      () =>
        prisma.ttsConfig.findUnique({
          where: { id: configId },
          select: { id: true, name: true, isGlobal: true },
        }),
      {
        notFoundResource: CONFIG_RESOURCE,
        resourceLabel: CONFIG_LABEL,
        operation: 'set as system default',
      }
    );
    if (config === null) {
      return;
    }

    await service.setAsDefault(configId);

    logger.info({ configId, name: config.name }, 'Set TTS config as system default');
    sendCustomSuccess(res, { success: true, configName: config.name }, StatusCodes.OK);
  };
}

function createSetFreeDefaultHandler(service: TtsConfigService, prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const configId = getRequiredParam(req.params.id, 'id');

    const config = await findGlobalConfigOrSendError(
      res,
      () =>
        prisma.ttsConfig.findUnique({
          where: { id: configId },
          select: { id: true, name: true, isGlobal: true, provider: true },
        }),
      {
        notFoundResource: CONFIG_RESOURCE,
        resourceLabel: CONFIG_LABEL,
        operation: 'set as free tier default',
      }
    );
    if (config === null) {
      return;
    }

    // TTS-shaped invariant: only self-hosted is free at the per-user level —
    // BYOK providers (elevenlabs, mistral) require user-supplied API keys,
    // so they can't serve guests as a fallback.
    if (!isSelfHostedTtsProvider(config.provider)) {
      return sendError(
        res,
        ErrorResponses.validationError(
          'Only self-hosted TTS configs can be set as free tier default (BYOK providers require user keys)'
        )
      );
    }

    await service.setAsFreeDefault(configId);

    logger.info({ configId, name: config.name }, 'Set TTS config as free tier default');
    sendCustomSuccess(res, { success: true, configName: config.name }, StatusCodes.OK);
  };
}

function createDeleteHandler(service: TtsConfigService, prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const configId = getRequiredParam(req.params.id, 'id');

    const config = await findGlobalConfigOrSendError(
      res,
      () =>
        prisma.ttsConfig.findUnique({
          where: { id: configId },
          select: { id: true, name: true, isGlobal: true },
        }),
      { notFoundResource: CONFIG_RESOURCE, resourceLabel: CONFIG_LABEL, operation: 'delete' }
    );
    if (config === null) {
      return;
    }

    // Pointer-membership guard (mirrors the LLM delete guard): the FKs are
    // ON DELETE SET NULL, so without this check a delete would silently null
    // the AdminSettings default pointer and drop TTS to the hardcoded floor.
    // Force the admin to point the default at another config first.
    const settings = await prisma.adminSettings.findUnique({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      select: { globalDefaultTtsConfigId: true, freeDefaultTtsConfigId: true },
    });
    if (settings?.globalDefaultTtsConfigId === configId) {
      return sendError(
        res,
        ErrorResponses.validationError(
          'Cannot delete the system default TTS config. Point the default at another config first.'
        )
      );
    }
    if (settings?.freeDefaultTtsConfigId === configId) {
      return sendError(
        res,
        ErrorResponses.validationError(
          'Cannot delete the free tier default TTS config. Point the free default at another config first.'
        )
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

    logger.info(logFields, 'Deleted global TTS config');
    sendCustomSuccess(res, responseBody, StatusCodes.OK);
  };
}

// --- Exported handler factories --------------------------------------------

function buildService(deps: RouteDeps): TtsConfigService {
  return new TtsConfigService(deps.prisma, deps.ttsConfigCacheInvalidation);
}

export const handleListGlobalTtsConfigs = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createListHandler(buildService(deps)));

export const handleGetGlobalTtsConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createGetHandler(buildService(deps)));

export const handleCreateGlobalTtsConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createCreateHandler(buildService(deps), deps.prisma));

export const handleUpdateGlobalTtsConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createEditHandler(buildService(deps), deps.prisma));

export const handleSetGlobalTtsConfigDefault = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createSetDefaultHandler(buildService(deps), deps.prisma));

export const handleSetGlobalTtsConfigFreeDefault = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createSetFreeDefaultHandler(buildService(deps), deps.prisma));

export const handleDeleteGlobalTtsConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createDeleteHandler(buildService(deps), deps.prisma));

// --- Main route factory ----------------------------------------------------

export function createAdminTtsConfigRoutes(deps: RouteDeps): Router {
  const router = Router();

  router.get('/', requireOwnerAuth(), handleListGlobalTtsConfigs(deps));
  router.get('/:id', requireOwnerAuth(), handleGetGlobalTtsConfig(deps));
  router.post('/', requireOwnerAuth(), handleCreateGlobalTtsConfig(deps));
  router.put('/:id', requireOwnerAuth(), handleUpdateGlobalTtsConfig(deps));
  router.put('/:id/set-default', requireOwnerAuth(), handleSetGlobalTtsConfigDefault(deps));
  router.put(
    '/:id/set-free-default',
    requireOwnerAuth(),
    handleSetGlobalTtsConfigFreeDefault(deps)
  );
  router.delete('/:id', requireOwnerAuth(), handleDeleteGlobalTtsConfig(deps));

  return router;
}
