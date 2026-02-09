/**
 * User Timezone Routes
 * GET /user/timezone - Get current timezone
 * PUT /user/timezone - Set timezone
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  UserService,
  type PrismaClient,
  isValidTimezone,
  getTimezoneInfo,
  SetTimezoneInputSchema,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { AuthenticatedRequest } from '../../types.js';

const logger = createLogger('user-timezone');

export function createTimezoneRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const userService = new UserService(prisma);

  /**
   * GET /user/timezone
   * Get current user's timezone
   */
  router.get(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      const user = await prisma.user.findFirst({
        where: { discordId: discordUserId },
        select: { timezone: true },
      });

      if (user === null) {
        // User doesn't exist yet, return default
        return sendCustomSuccess(
          res,
          {
            timezone: 'UTC',
            isDefault: true,
          },
          StatusCodes.OK
        );
      }

      sendCustomSuccess(
        res,
        {
          timezone: user.timezone,
          isDefault: user.timezone === 'UTC',
        },
        StatusCodes.OK
      );
    })
  );

  /**
   * PUT /user/timezone
   * Set user's timezone
   */
  router.put(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const discordUserId = req.userId;

      const parseResult = SetTimezoneInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }

      const { timezone } = parseResult.data;

      // Validate timezone
      if (!isValidTimezone(timezone)) {
        return sendError(
          res,
          ErrorResponses.validationError(
            `Invalid timezone: ${timezone}. Use a valid IANA timezone.`
          )
        );
      }

      logger.info({ discordUserId, timezone }, '[Timezone] Setting user timezone');

      // Ensure user exists via centralized UserService (creates shell user if needed)
      const userId = await userService.getOrCreateUser(discordUserId, discordUserId);
      if (userId === null) {
        // Should not happen for slash commands (bots can't use them)
        return sendError(res, ErrorResponses.validationError('Cannot create user for bot'));
      }

      // Update the timezone
      await prisma.user.update({
        where: { id: userId },
        data: { timezone },
      });

      // Find the label for the timezone
      const tzInfo = getTimezoneInfo(timezone);

      sendCustomSuccess(
        res,
        {
          success: true,
          timezone,
          label: tzInfo?.label ?? timezone,
          offset: tzInfo?.offset ?? 'Unknown',
        },
        StatusCodes.OK
      );
    })
  );

  return router;
}
