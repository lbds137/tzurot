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
import {
  createLogger,
  Prisma,
  generateChannelSettingsUuid,
  isValidDiscordId,
  type PrismaClient,
  type ConfigCascadeCacheInvalidationService,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../../services/AuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { mergeConfigOverrides } from '../../../utils/configOverrideMerge.js';
import { sendError, sendCustomSuccess } from '../../../utils/responseHelpers.js';
import { ErrorResponses } from '../../../utils/errorResponses.js';
import { getRequiredParam } from '../../../utils/requestParams.js';
import type { AuthenticatedRequest } from '../../../types.js';

const logger = createLogger('channel-config-overrides');

/** Validate channelId is a Discord snowflake. Returns false and sends error if invalid. */
function validateChannelId(channelId: string, res: Response): boolean {
  if (!isValidDiscordId(channelId)) {
    sendError(res, ErrorResponses.validationError('Invalid channelId format'));
    return false;
  }
  return true;
}

const CASCADE_INVALIDATION_WARN =
  '[ChannelConfigOverrides] Failed to publish cascade cache invalidation';

/**
 * Create GET handler for channel config overrides
 * GET /user/channel/:channelId/config-overrides
 */
export function createGetConfigOverridesHandler(prisma: PrismaClient): RequestHandler[] {
  return [
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
    }),
  ];
}

/**
 * Create PATCH handler for channel config overrides
 * PATCH /user/channel/:channelId/config-overrides
 *
 * Accepts Partial<ConfigOverrides> directly (same shape as user/personality tiers).
 * Send null for a field value to clear that override.
 */
export function createPatchConfigOverridesHandler(
  prisma: PrismaClient,
  cascadeInvalidation?: ConfigCascadeCacheInvalidationService
): RequestHandler[] {
  return [
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const channelId = getRequiredParam(req.params.channelId, 'channelId');
      if (!validateChannelId(channelId, res)) {
        return;
      }
      const input = req.body as Record<string, unknown>;

      // Get or create channel settings
      const settingsId = generateChannelSettingsUuid(channelId);
      const existing = await prisma.channelSettings.findUnique({
        where: { channelId },
        select: { configOverrides: true },
      });

      const merged = mergeConfigOverrides(existing?.configOverrides, input);
      if (merged === 'invalid') {
        sendError(res, ErrorResponses.validationError('Invalid config format'));
        return;
      }

      const configOverridesValue =
        merged === null ? Prisma.JsonNull : (merged as Prisma.InputJsonValue);

      // Upsert: create channel settings if they don't exist yet
      await prisma.channelSettings.upsert({
        where: { channelId },
        create: {
          id: settingsId,
          channelId,
          configOverrides: configOverridesValue,
        },
        update: {
          configOverrides: configOverridesValue,
        },
      });

      await tryInvalidateChannel(cascadeInvalidation, channelId);

      logger.info({ channelId, userId: req.userId }, 'Updated channel config overrides');
      sendCustomSuccess(res, { configOverrides: merged }, StatusCodes.OK);
    }),
  ];
}

/**
 * Create DELETE handler for channel config overrides
 * DELETE /user/channel/:channelId/config-overrides
 */
export function createDeleteConfigOverridesHandler(
  prisma: PrismaClient,
  cascadeInvalidation?: ConfigCascadeCacheInvalidationService
): RequestHandler[] {
  return [
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const channelId = getRequiredParam(req.params.channelId, 'channelId');
      if (!validateChannelId(channelId, res)) {
        return;
      }

      await prisma.channelSettings.updateMany({
        where: { channelId },
        data: { configOverrides: Prisma.JsonNull },
      });

      await tryInvalidateChannel(cascadeInvalidation, channelId);

      logger.info({ channelId, userId: req.userId }, 'Cleared channel config overrides');
      sendCustomSuccess(res, { success: true }, StatusCodes.OK);
    }),
  ];
}

/** Publish cascade invalidation for a channel, swallowing errors. */
async function tryInvalidateChannel(
  cascadeInvalidation: ConfigCascadeCacheInvalidationService | undefined,
  channelId: string
): Promise<void> {
  if (cascadeInvalidation === undefined) {
    return;
  }
  try {
    await cascadeInvalidation.invalidateChannel(channelId);
  } catch (error) {
    logger.warn({ err: error }, CASCADE_INVALIDATION_WARN);
  }
}
