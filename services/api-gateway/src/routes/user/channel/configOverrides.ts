/**
 * Channel Config Overrides Routes
 * CRUD for channel-level config cascade overrides
 *
 * Endpoints:
 * - GET /user/channel/:channelId/config-overrides - Get channel overrides
 * - PATCH /user/channel/:channelId/config-overrides - Update channel overrides (merge semantics)
 * - DELETE /user/channel/:channelId/config-overrides - Clear channel overrides
 *
 * Authorization: These endpoints use requireUserAuth() only (no guild permission check).
 * Discord permission enforcement (ManageMessages) happens in the bot-client layer before
 * calling the gateway. This is consistent with all other channel routes (activate, deactivate,
 * updateGuild) which follow the same trust model. An authenticated user bypassing the bot
 * could set overrides on any channel they know the snowflake of — acceptable for a
 * single-operator deployment with controlled API access.
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { isValidDiscordId } from '@tzurot/common-types/constants/discord';
import { Prisma } from '@tzurot/common-types/services/prisma';
import { generateChannelSettingsUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import {
  tryInvalidateCache,
  mergeAndValidateOverrides,
} from '../../../utils/configOverrideHelpers.js';
import { sendError, sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { getRequiredParam } from '../../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../../types.js';
import type { RouteDeps } from '../../routeDeps.js';

const logger = createLogger('channel-config-overrides');

/** Validate channelId is a Discord snowflake. Returns false and sends error if invalid. */
function validateChannelId(channelId: string, res: Response): boolean {
  if (!isValidDiscordId(channelId)) {
    sendError(res, ErrorResponses.validationError('Invalid channelId format'));
    return false;
  }
  return true;
}

/** GET /api/user/channel/:channelId/config-overrides — raw overrides */
export const handleGetChannelConfigOverrides = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const channelId = getRequiredParam(req.params.channelId, 'channelId');
    if (!validateChannelId(channelId, res)) {
      return;
    }

    const settings = await prisma.channelSettings.findUnique({
      where: { channelId },
      select: { configOverrides: true },
    });

    sendCustomSuccess(
      res,
      { configOverrides: (settings?.configOverrides as Record<string, unknown> | null) ?? null },
      StatusCodes.OK
    );
  });
};

/**
 * PATCH /api/user/channel/:channelId/config-overrides — merge update.
 * Accepts Partial<ConfigOverrides> directly; send a null field value to clear it.
 */
export const handleUpdateChannelConfigOverrides = (deps: RouteDeps): RequestHandler => {
  const { prisma, cascadeInvalidation } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const channelId = getRequiredParam(req.params.channelId, 'channelId');
    if (!validateChannelId(channelId, res)) {
      return;
    }
    const input = req.body as Record<string, unknown>;

    const settingsId = generateChannelSettingsUuid(channelId);
    const existing = await prisma.channelSettings.findUnique({
      where: { channelId },
      select: { configOverrides: true },
    });

    const { merged, prismaValue } = mergeAndValidateOverrides(
      existing?.configOverrides,
      input,
      res
    );
    if (merged === undefined) {
      return;
    }

    await prisma.channelSettings.upsert({
      where: { channelId },
      create: {
        id: settingsId,
        channelId,
        configOverrides: prismaValue,
      },
      update: {
        configOverrides: prismaValue,
      },
    });

    await tryInvalidateCache(
      cascadeInvalidation?.invalidateChannel.bind(cascadeInvalidation, channelId),
      { channelId }
    );

    logger.info({ channelId, userId: req.userId }, 'Updated channel config overrides');
    sendCustomSuccess(res, { configOverrides: merged }, StatusCodes.OK);
  });
};

/** DELETE /api/user/channel/:channelId/config-overrides — clear */
export const handleClearChannelConfigOverrides = (deps: RouteDeps): RequestHandler => {
  const { prisma, cascadeInvalidation } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const channelId = getRequiredParam(req.params.channelId, 'channelId');
    if (!validateChannelId(channelId, res)) {
      return;
    }

    await prisma.channelSettings.updateMany({
      where: { channelId },
      data: { configOverrides: Prisma.JsonNull },
    });

    await tryInvalidateCache(
      cascadeInvalidation?.invalidateChannel.bind(cascadeInvalidation, channelId),
      { channelId }
    );

    logger.info({ channelId, userId: req.userId }, 'Cleared channel config overrides');
    sendCustomSuccess(res, { success: true }, StatusCodes.OK);
  });
};

export function createGetConfigOverridesHandler(deps: RouteDeps): RequestHandler[] {
  return [
    requireUserAuth(),
    requireProvisionedUser(deps.prisma),
    handleGetChannelConfigOverrides(deps),
  ];
}

export function createPatchConfigOverridesHandler(deps: RouteDeps): RequestHandler[] {
  return [
    requireUserAuth(),
    requireProvisionedUser(deps.prisma),
    handleUpdateChannelConfigOverrides(deps),
  ];
}

export function createDeleteConfigOverridesHandler(deps: RouteDeps): RequestHandler[] {
  return [
    requireUserAuth(),
    requireProvisionedUser(deps.prisma),
    handleClearChannelConfigOverrides(deps),
  ];
}
