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
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { ProvisionedRequest } from '../../types.js';

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
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const userId = await resolveProvisionedUserId(req, userService);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });

      if (user === null) {
        return sendError(res, ErrorResponses.notFound('User'));
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
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
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

      logger.info({ discordUserId, timezone }, 'Setting user timezone');

      const userId = await resolveProvisionedUserId(req, userService);

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
