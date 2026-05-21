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

import { Router, type Response, type Request } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  isSelfHostedTtsProvider,
  type PrismaClient,
  type TtsConfigCacheInvalidationService,
  TtsConfigCreateSchema,
  TtsConfigUpdateSchema,
} from '@tzurot/common-types';
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
} from '../../utils/configRouteHelpers.js';

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
      service.formatConfigDetail({ ...c, advancedParameters: null })
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
    sendCustomSuccess(res, { config: formatted }, StatusCodes.OK);
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
    sendCustomSuccess(res, { config: formatted }, StatusCodes.CREATED);
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
    sendCustomSuccess(res, { config: formatted }, StatusCodes.OK);
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
          select: { id: true, name: true, isGlobal: true, isDefault: true, isFreeDefault: true },
        }),
      { notFoundResource: CONFIG_RESOURCE, resourceLabel: CONFIG_LABEL, operation: 'delete' }
    );
    if (config === null) {
      return;
    }

    if (config.isDefault) {
      return sendError(
        res,
        ErrorResponses.validationError('Cannot delete the system default TTS config')
      );
    }
    // Same hard-block shape as isDefault: deleting the free-tier default
    // would silently break TTS for all guest users until an admin sets
    // a new one. Force the admin to promote a replacement first.
    if (config.isFreeDefault) {
      return sendError(
        res,
        ErrorResponses.validationError('Cannot delete the free tier default TTS config')
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

// --- Main route factory ----------------------------------------------------

export function createAdminTtsConfigRoutes(
  prisma: PrismaClient,
  ttsConfigCacheInvalidation?: TtsConfigCacheInvalidationService
): Router {
  const router = Router();
  const service = new TtsConfigService(prisma, ttsConfigCacheInvalidation);

  router.get('/', requireOwnerAuth(), asyncHandler(createListHandler(service)));
  router.get('/:id', requireOwnerAuth(), asyncHandler(createGetHandler(service)));
  router.post('/', requireOwnerAuth(), asyncHandler(createCreateHandler(service, prisma)));
  router.put('/:id', requireOwnerAuth(), asyncHandler(createEditHandler(service, prisma)));
  router.put(
    '/:id/set-default',
    requireOwnerAuth(),
    asyncHandler(createSetDefaultHandler(service, prisma))
  );
  router.put(
    '/:id/set-free-default',
    requireOwnerAuth(),
    asyncHandler(createSetFreeDefaultHandler(service, prisma))
  );
  router.delete('/:id', requireOwnerAuth(), asyncHandler(createDeleteHandler(service, prisma)));

  return router;
}
