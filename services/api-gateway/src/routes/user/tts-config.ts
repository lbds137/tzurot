/**
 * User TTS Config Routes
 * CRUD operations for user-owned TTS configurations
 *
 * Endpoints:
 * - GET    /user/tts-config     - List configs (global + user)
 * - GET    /user/tts-config/:id - Get single config detail
 * - POST   /user/tts-config     - Create user config
 * - PUT    /user/tts-config/:id - Update user config
 * - DELETE /user/tts-config/:id - Delete user config
 *
 * Mirrors `routes/user/llm-config.ts` shape minus LLM-specific concerns
 * (no model-context enrichment via OpenRouterModelCache, no model-fields
 * validation, no resolve handler — TTS resolution lives in ai-worker's
 * `TtsDispatcher` and isn't exposed via this route family for PR 3b).
 *
 * Permissions: reuses `computeLlmConfigPermissions` from common-types since
 * its signature `(config: { ownerId, isGlobal }, userId, discordUserId)` is
 * domain-agnostic over "ownable + globally-toggleable" entities. A future
 * cross-cutting refactor could rename it `computeOwnableEntityPermissions`;
 * filed as a follow-up rather than introduced in PR 3b.
 */

import { Router, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  type TtsConfigSummary,
  TtsConfigCreateSchema,
  TtsConfigUpdateSchema,
} from '@tzurot/common-types/schemas/api/tts-config';
import { type TtsProviderId } from '@tzurot/common-types/services/tts/TtsProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { computeLlmConfigPermissions } from '@tzurot/common-types/utils/permissions';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { isPrismaUniqueConstraintError } from '../../utils/prismaErrors.js';
import { getRequiredParam } from '../../utils/requestParams.js';
import {
  parseBodyOrSendError,
  findConfigOrSendNotFound,
  ensureNoNameCollision,
} from '../../utils/configRouteHelpers.js';
import {
  applyOwnerNamePromotion,
  buildCollisionMessage,
  getDiscordUsernameFromRequest,
} from '../../utils/normalizeConfigNameOnPromote.js';
import type { ProvisionedRequest } from '../../types.js';
import {
  TtsConfigService,
  TtsAutoSuffixCollisionError,
  TtsCloneNameExhaustedError,
  TtsInvalidProviderError,
  type TtsConfigScope,
} from '../../services/TtsConfigService.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('user-tts-config');

const CONFIG_RESOURCE = 'TtsConfig';

// --- Handler factories -----------------------------------------------------

function createListHandler(service: TtsConfigService) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = resolveProvisionedUserId(req);

    // Admin sees everything (GLOBAL scope returns all configs); regular
    // users see globals + their own.
    const isAdmin = isBotOwner(discordUserId);
    const scope: TtsConfigScope = isAdmin
      ? { type: 'GLOBAL' }
      : { type: 'USER', userId, discordId: discordUserId };

    const rawConfigs = await service.list(scope);

    // `formatConfigDetail` projects only public fields (drops the internal
    // `ownerId` the list select carries; `c.ownerId` is read below for the
    // ownership computation but must not leak into the response). Same pattern
    // as the admin TTS list. The DB column is VARCHAR(40); writes are guarded by
    // TtsConfigCreateSchema (TtsProviderIdSchema refinement) on create and
    // isTtsProviderId at the service layer on update, so any value reaching this
    // point is a valid TtsProviderId — the cast bridges the schema/runtime gap.
    const configs: TtsConfigSummary[] = rawConfigs.map(c => ({
      ...service.formatConfigDetail({ ...c, advancedParameters: null }),
      provider: c.provider as TtsProviderId,
      isOwned: c.ownerId === userId,
      permissions: computeLlmConfigPermissions(
        { ownerId: c.ownerId, isGlobal: c.isGlobal },
        userId,
        discordUserId
      ),
    }));

    logger.info({ discordUserId, count: configs.length }, 'Listed TTS configs');
    sendCustomSuccess(res, { configs }, StatusCodes.OK);
  };
}

function createGetHandler(service: TtsConfigService) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getRequiredParam(req.params.id, 'id');

    const config = await findConfigOrSendNotFound(
      res,
      () => service.getById(configId),
      CONFIG_RESOURCE
    );
    if (config === null) {
      return;
    }

    const userId = resolveProvisionedUserId(req);
    const isOwned = config.ownerId === userId;
    const permissions = computeLlmConfigPermissions(
      { ownerId: config.ownerId, isGlobal: config.isGlobal },
      userId,
      discordUserId
    );
    const formatted = service.formatConfigDetail(config);

    logger.debug({ discordUserId, configId }, 'Fetched TTS config');
    sendCustomSuccess(res, { config: { ...formatted, isOwned, permissions } }, StatusCodes.OK);
  };
}

function createCreateHandler(service: TtsConfigService) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    const body = parseBodyOrSendError(res, TtsConfigCreateSchema, req.body);
    if (body === null) {
      return;
    }

    const userId = resolveProvisionedUserId(req);

    // Skip duplicate-name check when client opts into autoSuffixOnCollision
    // (the clone flow); service bumps `(Copy N)` server-side.
    if (
      body.autoSuffixOnCollision !== true &&
      !(await ensureNoNameCollision(res, service, {
        name: body.name,
        scope: { type: 'USER', userId, discordId: discordUserId },
        formatCollisionMessage: n => `You already have a TTS config named "${n}"`,
      }))
    ) {
      return;
    }

    let config;
    try {
      config = await service.create(
        { type: 'USER', userId, discordId: discordUserId },
        body,
        userId
      );
    } catch (err) {
      if (err instanceof TtsAutoSuffixCollisionError) {
        return sendError(
          res,
          ErrorResponses.nameCollision(
            `Name "${err.effectiveName}" was taken by a concurrent request. Please try again.`
          )
        );
      }
      if (err instanceof TtsCloneNameExhaustedError) {
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
          ErrorResponses.nameCollision(`You already have a TTS config named "${body.name}"`)
        );
      }
      throw err;
    }

    const permissions = computeLlmConfigPermissions(
      { ownerId: userId, isGlobal: false },
      userId,
      discordUserId
    );
    const formatted = service.formatConfigDetail(config);

    logger.info(
      { discordUserId, configId: config.id, name: config.name, provider: config.provider },
      'Created TTS config'
    );
    sendCustomSuccess(
      res,
      { config: { ...formatted, isOwned: true, permissions } },
      StatusCodes.CREATED
    );
  };
}

function createUpdateHandler(service: TtsConfigService) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getRequiredParam(req.params.id, 'id');

    const body = parseBodyOrSendError(res, TtsConfigUpdateSchema, req.body);
    if (body === null) {
      return;
    }

    const userId = resolveProvisionedUserId(req);

    const config = await findConfigOrSendNotFound(
      res,
      () => service.getById(configId),
      CONFIG_RESOURCE
    );
    if (config === null) {
      return;
    }

    if (config.ownerId !== userId) {
      return sendError(res, ErrorResponses.unauthorized('You can only edit your own TTS configs'));
    }

    // Empty-body guard runs BEFORE the promotion helper so that a PUT with
    // `{}` returns 400 (preserves the original API contract) rather than
    // silently triggering a retroactive rename on already-global configs
    // whose name predates this PR.
    if (Object.keys(body).length === 0) {
      return sendError(res, ErrorResponses.validationError('No fields to update'));
    }

    // If the user is promoting their own config to global (or already had it
    // global and is renaming), suffix the name with their username so other
    // users can identify provenance — prevents non-bot-owners from creating
    // names that look admin-curated. Bot owner gets unsuffixed names per
    // `normalizeSlugForUser`'s built-in semantic. Mirrors the LLM route.
    const patch = applyOwnerNamePromotion(body, config, {
      discordId: discordUserId,
      discordUsername: getDiscordUsernameFromRequest(req),
    });

    // Compute post-update isGlobal so the collision check covers the cross-
    // user global-namespace case when the user is promoting (or already
    // promoted) their config.
    const postIsGlobal = body.isGlobal ?? config.isGlobal;

    if (
      patch.name !== undefined &&
      !(await ensureNoNameCollision(res, service, {
        name: patch.name,
        scope: { type: 'USER', userId, discordId: discordUserId },
        excludeId: configId,
        postIsGlobal,
        formatCollisionMessage: n =>
          buildCollisionMessage({
            effectiveName: n,
            requestedName: body.name,
            configKind: 'TTS config',
          }),
      }))
    ) {
      return;
    }

    // Empty-body guard ran earlier; patch is guaranteed non-empty here. Wrap
    // in try/catch: a parallel mutation could slip a colliding name in between
    // checkNameExists and update, surfacing as Prisma P2002. Translate to a
    // friendly nameCollision rather than letting Express return a 500.
    let updated;
    try {
      updated = await service.update(configId, patch);
    } catch (err) {
      if (err instanceof TtsInvalidProviderError) {
        return sendError(
          res,
          ErrorResponses.validationError(
            `Invalid provider "${err.provider}" — must be one of self-hosted, elevenlabs, mistral`
          )
        );
      }
      if (isPrismaUniqueConstraintError(err) && patch.name !== undefined) {
        return sendError(
          res,
          ErrorResponses.nameCollision(
            `The name "${patch.name}" was just taken by another user — try again`
          )
        );
      }
      throw err;
    }

    const permissions = computeLlmConfigPermissions(
      { ownerId: userId, isGlobal: updated.isGlobal },
      userId,
      discordUserId
    );
    const formatted = service.formatConfigDetail(updated);

    logger.info(
      { discordUserId, configId, name: updated.name, updates: Object.keys(body) },
      'Updated TTS config'
    );
    sendCustomSuccess(
      res,
      { config: { ...formatted, isOwned: true, permissions } },
      StatusCodes.OK
    );
  };
}

function createDeleteHandler(service: TtsConfigService) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getRequiredParam(req.params.id, 'id');

    const userId = resolveProvisionedUserId(req);

    const config = await findConfigOrSendNotFound(
      res,
      () => service.getById(configId),
      CONFIG_RESOURCE
    );
    if (config === null) {
      return;
    }

    const permissions = computeLlmConfigPermissions(
      { ownerId: config.ownerId, isGlobal: config.isGlobal },
      userId,
      discordUserId
    );
    if (!permissions.canDelete) {
      return sendError(
        res,
        ErrorResponses.unauthorized('You can only delete your own TTS configs')
      );
    }

    // User-route deletes own configs only — warning unlikely in practice
    // (would mean OTHER users adopted it as their default, possible only for
    // shared/global configs the user owns). Surfaced for symmetry with the
    // admin route's contract.
    const { blocker } = await service.checkDeleteConstraints(configId);
    if (blocker !== null) {
      return sendError(res, ErrorResponses.validationError(blocker));
    }

    await service.delete(configId);

    logger.info({ discordUserId, configId, name: config.name }, 'Deleted TTS config');
    sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
  };
}

// --- Exported handler factories --------------------------------------------

function buildService(deps: RouteDeps): TtsConfigService {
  return new TtsConfigService(deps.prisma, deps.ttsConfigCacheInvalidation);
}

export const handleListUserTtsConfigs = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createListHandler(buildService(deps)));

export const handleGetUserTtsConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createGetHandler(buildService(deps)));

export const handleCreateUserTtsConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createCreateHandler(buildService(deps)));

export const handleUpdateUserTtsConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createUpdateHandler(buildService(deps)));

export const handleDeleteUserTtsConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createDeleteHandler(buildService(deps)));

// --- Main route factory ----------------------------------------------------

export function createTtsConfigRoutes(deps: RouteDeps): Router {
  const router = Router();
  const requireProvisioned = requireProvisionedUser(deps.prisma);

  router.get('/', requireUserAuth(), requireProvisioned, handleListUserTtsConfigs(deps));
  router.get('/:id', requireUserAuth(), requireProvisioned, handleGetUserTtsConfig(deps));
  router.post('/', requireUserAuth(), requireProvisioned, handleCreateUserTtsConfig(deps));
  router.put('/:id', requireUserAuth(), requireProvisioned, handleUpdateUserTtsConfig(deps));
  router.delete('/:id', requireUserAuth(), requireProvisioned, handleDeleteUserTtsConfig(deps));

  return router;
}
