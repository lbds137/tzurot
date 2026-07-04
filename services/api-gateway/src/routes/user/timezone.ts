/**
 * User Timezone Routes
 * GET /user/timezone - Get current timezone
 * PUT /user/timezone - Set timezone
 */

import { Router, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { isValidTimezone, getTimezoneInfo } from '@tzurot/common-types/constants/timezone';
import { SetTimezoneInputSchema } from '@tzurot/common-types/schemas/api/timezone';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('user-timezone');

/** GET /api/user/timezone — fetch current user's timezone */
export const handleGetTimezone = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const userId = resolveProvisionedUserId(req);

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
  });
};

/** PUT /api/user/timezone — set the current user's timezone */
export const handleSetTimezone = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    const discordUserId = req.userId;

    const parseResult = SetTimezoneInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { timezone } = parseResult.data;

    if (!isValidTimezone(timezone)) {
      return sendError(
        res,
        ErrorResponses.validationError(`Invalid timezone: ${timezone}. Use a valid IANA timezone.`)
      );
    }

    logger.info({ discordUserId, timezone }, 'Setting user timezone');

    const userId = resolveProvisionedUserId(req);

    await prisma.user.update({
      where: { id: userId },
      data: { timezone },
    });

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
  });
};

export function createTimezoneRoutes(deps: RouteDeps): Router {
  const router = Router();
  router.get('/', requireUserAuth(), requireProvisionedUser(deps.prisma), handleGetTimezone(deps));
  router.put('/', requireUserAuth(), requireProvisionedUser(deps.prisma), handleSetTimezone(deps));
  return router;
}
