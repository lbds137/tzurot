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

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  isBotOwner,
  type PrismaClient,
  type TtsConfigSummary,
  type TtsConfigCacheInvalidationService,
  type TtsProviderId,
  computeLlmConfigPermissions,
  TtsConfigCreateSchema,
  TtsConfigUpdateSchema,
} from '@tzurot/common-types';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { isPrismaUniqueConstraintError } from '../../utils/prismaErrors.js';
import { getRequiredParam } from '../../utils/requestParams.js';
import {
  computeNameForPromotion,
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

    // The DB column is VARCHAR(40); writes are guarded by TtsConfigCreateSchema
    // (TtsProviderIdSchema refinement) on create and isTtsProviderId at the
    // service layer on update, so any value reaching this point is a valid
    // TtsProviderId. The cast bridges the schema/runtime gap.
    const configs: TtsConfigSummary[] = rawConfigs.map(c => ({
      ...c,
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

    const config = await service.getById(configId);
    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_RESOURCE));
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

    const parseResult = TtsConfigCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const body = parseResult.data;

    const userId = resolveProvisionedUserId(req);

    // Skip duplicate-name check when client opts into autoSuffixOnCollision
    // (the clone flow); service bumps `(Copy N)` server-side.
    if (body.autoSuffixOnCollision !== true) {
      const nameCheck = await service.checkNameExists(body.name, {
        type: 'USER',
        userId,
        discordId: discordUserId,
      });
      if (nameCheck.exists) {
        return sendError(
          res,
          ErrorResponses.nameCollision(`You already have a TTS config named "${body.name}"`)
        );
      }
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

    const parseResult = TtsConfigUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const body = parseResult.data;

    const userId = resolveProvisionedUserId(req);

    const config = await service.getById(configId);
    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_RESOURCE));
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
    const effectiveName = computeNameForPromotion({
      currentName: config.name,
      currentIsGlobal: config.isGlobal,
      requestedName: body.name,
      requestedIsGlobal: body.isGlobal,
      discordId: discordUserId,
      discordUsername: getDiscordUsernameFromRequest(req),
    });
    const patch = { ...body, ...(effectiveName !== undefined ? { name: effectiveName } : {}) };

    if (patch.name !== undefined && patch.name.length > 0) {
      const nameCheck = await service.checkNameExists(
        patch.name,
        { type: 'USER', userId, discordId: discordUserId },
        configId
      );
      if (nameCheck.exists) {
        // When the post-normalization name differs from what the user
        // actually typed (either the user sent only `{ isGlobal: true }`
        // and the suffix was synthesized, OR they typed a base name that
        // got suffixed), the message should explain the auto-rename rather
        // than imply they chose the exact colliding name.
        const wasNormalized = patch.name !== body.name;
        const msg = wasNormalized
          ? `Promotion would rename your TTS config to "${patch.name}", but that name is already taken`
          : `You already have a TTS config named "${patch.name}"`;
        return sendError(res, ErrorResponses.nameCollision(msg));
      }
    }

    // Empty-body guard ran earlier; patch is guaranteed non-empty here.
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

    const config = await service.getById(configId);
    if (config === null) {
      return sendError(res, ErrorResponses.notFound(CONFIG_RESOURCE));
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

    const constraintError = await service.checkDeleteConstraints(configId);
    if (constraintError !== null) {
      return sendError(res, ErrorResponses.validationError(constraintError));
    }

    await service.delete(configId);

    logger.info({ discordUserId, configId, name: config.name }, 'Deleted TTS config');
    sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
  };
}

// --- Main route factory ----------------------------------------------------

export function createTtsConfigRoutes(
  prisma: PrismaClient,
  ttsConfigCacheInvalidation?: TtsConfigCacheInvalidationService
): Router {
  const router = Router();
  const service = new TtsConfigService(prisma, ttsConfigCacheInvalidation);

  router.get(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createListHandler(service))
  );
  router.get(
    '/:id',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createGetHandler(service))
  );
  router.post(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createCreateHandler(service))
  );
  router.put(
    '/:id',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createUpdateHandler(service))
  );
  router.delete(
    '/:id',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(createDeleteHandler(service))
  );

  return router;
}
