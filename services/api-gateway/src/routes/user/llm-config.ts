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

import { Router, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import {
  type LlmConfigSummary,
  LlmConfigCreateSchema,
  LlmConfigUpdateSchema,
} from '@tzurot/common-types/schemas/api/llm-config';
import { toConfigKind } from '@tzurot/common-types/services/LlmConfigMapper';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
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
  parseConfigKindQueryAllowAll,
  findConfigOrSendNotFound,
  ensureNoNameCollision,
} from '../../utils/configRouteHelpers.js';
import type { ProvisionedRequest } from '../../types.js';
import {
  LlmConfigService,
  AutoSuffixCollisionError,
  CloneNameExhaustedError,
  type LlmConfigScope,
} from '../../services/LlmConfigService.js';
import type { OpenRouterModelCache } from '../../services/OpenRouterModelCache.js';
import { ModelCapabilityService } from '../../services/ModelCapabilityService.js';
import { enrichWithModelContext, computeRequiresZaiKey } from '../../utils/modelValidation.js';
import { validateLlmConfigModelFields } from '../../utils/llmConfigValidation.js';
import { userHasActiveApiKey } from '../../utils/userHasActiveApiKey.js';
import {
  applyOwnerNamePromotion,
  buildCollisionMessage,
  getDiscordUsernameFromRequest,
} from '../../utils/normalizeConfigNameOnPromote.js';
import { createResolveHandler } from './llmConfigResolve.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('user-llm-config');

/** Common error message for config not found */
const CONFIG_RESOURCE = 'Config';

// ============================================================================
// Schemas - imported from @tzurot/common-types (single source of truth)
// ============================================================================

// --- Handler Factories ---

function createListHandler(service: LlmConfigService, modelCache?: OpenRouterModelCache) {
  // Stateless wrapper over the cache ref — built once per handler, not per request.
  const capabilities = new ModelCapabilityService(modelCache);
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const userId = resolveProvisionedUserId(req);

    // Admin sees all presets (same pattern as character browse)
    // Regular users see global + their own. Browse passes `?kind=all` to list
    // both kinds in one call; autocomplete passes an explicit text|vision.
    const kind = parseConfigKindQueryAllowAll(res, req.query);
    if (kind === null) {
      return;
    }

    const isAdmin = isBotOwner(discordUserId);
    const scope: LlmConfigScope = isAdmin
      ? { type: 'GLOBAL' }
      : { type: 'USER', userId, discordId: discordUserId };

    const rawConfigs = await service.list(scope, kind);

    // Enrich with ownership and permissions (user-specific). `formatConfigSummary`
    // projects only public fields — `c.ownerId` is read here for the ownership
    // computation but must not leak into the response (it would expose other
    // users' internal IDs in the global-config rows).
    const configs: LlmConfigSummary[] = await Promise.all(
      rawConfigs.map(async c => ({
        ...service.formatConfigSummary(c),
        isOwned: c.ownerId === userId,
        // Capability-driven vision eligibility, sourced live from the model
        // (not the config's `kind`). Cheap: a cached array lookup per row.
        supportsVision: await capabilities.supportsVision(c.model),
        permissions: computeLlmConfigPermissions(
          { ownerId: c.ownerId, isGlobal: c.isGlobal },
          userId,
          discordUserId
        ),
      }))
    );

    logger.info({ discordUserId, count: configs.length }, 'Listed configs');
    sendCustomSuccess(res, { configs }, StatusCodes.OK);
  };
}

function createGetHandler(
  service: LlmConfigService,
  prisma: PrismaClient,
  modelCache?: OpenRouterModelCache
) {
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

    // Badge the dashboard when this viewer can't run the model without a z.ai key
    // (z.ai-only model + no z.ai-coding key). Keyed off the VIEWER, so the same
    // global preset shows the badge to a keyless user but not to one with a key.
    const hasZaiCodingKey = await userHasActiveApiKey(prisma, userId, AIProvider.ZaiCoding);
    const requiresZaiKey = await computeRequiresZaiKey(config.model, hasZaiCodingKey, modelCache);

    logger.debug({ discordUserId, configId }, 'Fetched config');
    sendCustomSuccess(
      res,
      { config: { ...formatted, isOwned, permissions, requiresZaiKey } },
      StatusCodes.OK
    );
  };
}

function createCreateHandler(
  service: LlmConfigService,
  prisma: PrismaClient,
  modelCache?: OpenRouterModelCache
) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    const body = parseBodyOrSendError(res, LlmConfigCreateSchema, req.body);
    if (body === null) {
      return;
    }

    // resolveProvisionedUserId is a pure req-reader, free to run before
    // validation — needed here so the z.ai key check can gate z.ai-catalog
    // model validation.
    const userId = resolveProvisionedUserId(req);
    const hasZaiCodingKey = await userHasActiveApiKey(prisma, userId, AIProvider.ZaiCoding);

    if (
      !(await validateLlmConfigModelFields({
        res,
        modelCache,
        body,
        hasZaiCodingKey,
        kind: body.kind,
      }))
    ) {
      return;
    }

    // Duplicate-name check is skipped when the client opts into
    // autoSuffixOnCollision (the preset clone flow): the service will bump
    // the (Copy N) suffix server-side until it finds a free slot. For
    // regular creates, strict name-uniqueness still surfaces as an error.
    if (
      body.autoSuffixOnCollision !== true &&
      !(await ensureNoNameCollision(res, service, {
        name: body.name,
        scope: { type: 'USER', userId, discordId: discordUserId },
        kind: body.kind,
        formatCollisionMessage: n => `You already have a config named "${n}"`,
      }))
    ) {
      return;
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
    const requiresZaiKey = await computeRequiresZaiKey(config.model, hasZaiCodingKey, modelCache);

    logger.info({ discordUserId, configId: config.id, name: config.name }, 'Created config');
    sendCustomSuccess(
      res,
      { config: { ...formatted, isOwned: true, permissions, requiresZaiKey } },
      StatusCodes.CREATED
    );
  };
}

/**
 * Build the update patch (applying owner-name promotion on owner edits) and
 * verify the resulting name doesn't collide in the owner's namespace. Returns
 * the patch on success, or `null` when a collision error has already been sent
 * to `res` (caller returns immediately). Generic over the body type so the
 * full update payload (advancedParameters, contextWindowTokens, …) survives —
 * only the name/isGlobal fields drive promotion + collision logic.
 */
async function buildUpdatePatchOrSendCollision<
  TBody extends { name?: string; isGlobal?: boolean },
>(opts: {
  res: Response;
  service: LlmConfigService;
  req: ProvisionedRequest;
  body: TBody;
  /** Includes `kind` (the immutable discriminator) so the name-collision check
   *  is scoped to the config's kind — a vision rename collides only against
   *  vision names, never text. Derived from the row, not the request: kind is
   *  intrinsic to the config and can't be changed by an update. */
  config: { name: string; isGlobal: boolean; ownerId: string; kind: string };
  configId: string;
  isOwnedByRequester: boolean;
}): Promise<TBody | null> {
  const { res, service, req, body, config, configId, isOwnedByRequester } = opts;
  const discordUserId = req.userId;

  // Owner edits run the promotion helper; admin edits on non-owned configs
  // apply the name verbatim (suffixing would mis-attribute provenance).
  const user = { discordId: req.userId, discordUsername: getDiscordUsernameFromRequest(req) };
  const patch = isOwnedByRequester ? applyOwnerNamePromotion(body, config, user) : { ...body };

  // Compute post-update isGlobal so the collision check covers the cross-
  // user global-namespace case when the user is promoting (or already
  // promoted) their config.
  const postIsGlobal = body.isGlobal ?? config.isGlobal;

  // Check for duplicate name if a name is being applied (either user-supplied
  // or normalized by the promotion helper). Bot-owner-editing-others uses
  // the OWNER's userId for namespace scoping (the name lives in the
  // owner's namespace, not the requester's).
  if (
    patch.name !== undefined &&
    !(await ensureNoNameCollision(res, service, {
      name: patch.name,
      scope: { type: 'USER', userId: config.ownerId, discordId: discordUserId },
      excludeId: configId,
      postIsGlobal,
      kind: toConfigKind(config.kind),
      formatCollisionMessage: n =>
        buildCollisionMessage({
          effectiveName: n,
          requestedName: body.name,
          configKind: 'config',
        }),
    }))
  ) {
    return null;
  }

  return patch;
}

function createUpdateHandler(
  service: LlmConfigService,
  prisma: PrismaClient,
  modelCache?: OpenRouterModelCache
) {
  return async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;
    const configId = getRequiredParam(req.params.id, 'id');

    const body = parseBodyOrSendError(res, LlmConfigUpdateSchema, req.body);
    if (body === null) {
      return;
    }

    // Resolve userId before validation so the z.ai key check can gate
    // z.ai-catalog model validation (mirrors the create handler).
    const userId = resolveProvisionedUserId(req);
    const hasZaiCodingKey = await userHasActiveApiKey(prisma, userId, AIProvider.ZaiCoding);

    if (
      !(await validateLlmConfigModelFields({
        res,
        modelCache,
        body,
        fallback: { service, configId: configId },
        hasZaiCodingKey,
      }))
    ) {
      return;
    }

    // User by-id routes are kind-agnostic: the id unambiguously identifies the
    // config of whatever kind, and kind is immutable. A `?kind=` query param
    // here is intentionally ignored — the collision check below derives kind
    // from the stored row, not the request.
    const config = await findConfigOrSendNotFound(
      res,
      () => service.getById(configId),
      CONFIG_RESOURCE
    );
    if (config === null) {
      return;
    }

    // Permission gate. computeLlmConfigPermissions grants canEdit to creator
    // OR bot owner (admin override) — see packages/common-types/src/utils/permissions.ts.
    // Bot owner editing another user's preset is a moderation/maintenance path.
    const editPermissions = computeLlmConfigPermissions(
      { ownerId: config.ownerId, isGlobal: config.isGlobal },
      userId,
      discordUserId
    );
    if (!editPermissions.canEdit) {
      return sendError(res, ErrorResponses.unauthorized('You can only edit your own configs'));
    }
    const isOwnedByRequester = config.ownerId === userId;

    // Empty-body guard runs BEFORE the promotion helper so that a PUT with
    // `{}` returns 400 rather than silently triggering a retroactive rename on
    // an already-global config (the promotion helper would otherwise normalize
    // the existing name on an empty edit).
    if (Object.keys(body).length === 0) {
      return sendError(res, ErrorResponses.validationError('No fields to update'));
    }

    const patch = await buildUpdatePatchOrSendCollision({
      res,
      service,
      req,
      body,
      config,
      configId,
      isOwnedByRequester,
    });
    if (patch === null) {
      return;
    }

    // Update using service (handles cache invalidation). Empty-body guard
    // ran earlier; patch is guaranteed non-empty here. Wrap in try/catch:
    // a parallel mutation could slip a colliding name in between checkNameExists
    // and update, surfacing as Prisma P2002. Translate to a friendly
    // nameCollision rather than letting Express return a 500.
    let updated;
    try {
      updated = await service.update(configId, patch);
    } catch (err) {
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

    // Permissions reflect the requester's view of the (post-update) config.
    // ownerId stays the original owner's even after a bot-owner edit.
    const permissions = computeLlmConfigPermissions(
      { ownerId: updated.ownerId, isGlobal: updated.isGlobal },
      userId,
      discordUserId
    );

    // Format with service helper, then add user-specific fields
    const formatted = service.formatConfigDetail(updated);
    await enrichWithModelContext(formatted, updated.model, modelCache);
    const requiresZaiKey = await computeRequiresZaiKey(updated.model, hasZaiCodingKey, modelCache);

    logger.info(
      {
        discordUserId,
        configId,
        name: updated.name,
        updates: Object.keys(body),
        adminEdit: !isOwnedByRequester,
      },
      isOwnedByRequester ? 'Updated config' : 'Admin updated another user config'
    );

    sendCustomSuccess(
      res,
      { config: { ...formatted, isOwned: isOwnedByRequester, permissions, requiresZaiKey } },
      StatusCodes.OK
    );
  };
}

function createDeleteHandler(service: LlmConfigService) {
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

    // Use centralized permission computation for consistency
    const permissions = computeLlmConfigPermissions(
      { ownerId: config.ownerId, isGlobal: config.isGlobal },
      userId,
      discordUserId
    );
    if (!permissions.canDelete) {
      return sendError(res, ErrorResponses.unauthorized('You can only delete your own configs'));
    }
    const isAdminBypass = config.ownerId !== userId;

    // Check delete constraints using service. Bot owner deleting another
    // user's preset BYPASSES the in-use blocker — the underlying FK constraints
    // already cascade safely (PersonalityDefaultConfig has ON DELETE CASCADE,
    // UserPersonalityConfig.llmConfigId has ON DELETE SET NULL). The blocker
    // is an application-level safety check for the owner-driven path.
    const { blocker } = await service.checkDeleteConstraints(configId);
    if (blocker !== null && !isAdminBypass) {
      return sendError(res, ErrorResponses.validationError(blocker));
    }

    // Delete using service (handles cache invalidation). FK cascades clean up
    // PersonalityDefaultConfig rows + null out UserPersonalityConfig refs.
    await service.delete(configId);

    logger.info(
      {
        discordUserId,
        configId,
        name: config.name,
        adminBypass: isAdminBypass,
        cascadedBlocker: isAdminBypass ? blocker : null,
      },
      isAdminBypass ? 'Admin deleted another user config (cascaded)' : 'Deleted config'
    );
    sendCustomSuccess(res, { deleted: true }, StatusCodes.OK);
  };
}

// --- Exported handler factories ---

function buildService(deps: RouteDeps): LlmConfigService {
  return new LlmConfigService(deps.prisma, deps.llmConfigCacheInvalidation);
}

export const handleListUserLlmConfigs = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createListHandler(buildService(deps), deps.modelCache));

export const handleGetUserLlmConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createGetHandler(buildService(deps), deps.prisma, deps.modelCache));

export const handleCreateUserLlmConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createCreateHandler(buildService(deps), deps.prisma, deps.modelCache));

export const handleResolveUserLlmConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createResolveHandler(deps.prisma, deps.cascadeResolver, deps.llmConfigResolver));

export const handleUpdateUserLlmConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createUpdateHandler(buildService(deps), deps.prisma, deps.modelCache));

export const handleDeleteUserLlmConfig = (deps: RouteDeps): RequestHandler =>
  asyncHandler(createDeleteHandler(buildService(deps)));

// --- Main Route Factory ---

export function createLlmConfigRoutes(deps: RouteDeps): Router {
  const router = Router();
  const requireProvisioned = requireProvisionedUser(deps.prisma);

  router.get('/', requireUserAuth(), requireProvisioned, handleListUserLlmConfigs(deps));
  router.get('/:id', requireUserAuth(), requireProvisioned, handleGetUserLlmConfig(deps));
  router.post('/', requireUserAuth(), requireProvisioned, handleCreateUserLlmConfig(deps));
  router.post('/resolve', requireUserAuth(), requireProvisioned, handleResolveUserLlmConfig(deps));
  router.put('/:id', requireUserAuth(), requireProvisioned, handleUpdateUserLlmConfig(deps));
  router.delete('/:id', requireUserAuth(), requireProvisioned, handleDeleteUserLlmConfig(deps));

  return router;
}
