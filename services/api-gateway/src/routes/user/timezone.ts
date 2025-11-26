/**
 * User Timezone Routes
 * GET /user/timezone - Get current timezone
 * PUT /user/timezone - Set timezone
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  type PrismaClient,
  isValidTimezone,
  getTimezoneInfo,
} from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('user-timezone');

interface SetTimezoneRequest {
  timezone: string;
}

export function createTimezoneRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /user/timezone
   * Get current user's timezone
   */
  router.get(
    '/',
    requireUserAuth(),
    asyncHandler(async (req: Request, res: Response) => {
      const discordUserId = (req as Request & { userId: string }).userId;

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
    asyncHandler(async (req: Request, res: Response) => {
      const discordUserId = (req as Request & { userId: string }).userId;
      const { timezone } = req.body as SetTimezoneRequest;

      // Validate required field
      if (timezone === undefined || timezone === null || timezone.length === 0) {
        return sendError(res, ErrorResponses.validationError('timezone is required'));
      }

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

      // Upsert user with timezone
      await prisma.user.upsert({
        where: { discordId: discordUserId },
        update: { timezone },
        create: {
          discordId: discordUserId,
          username: discordUserId, // Placeholder, can be updated later
          timezone,
        },
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
