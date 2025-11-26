/**
 * User Timezone Routes
 * GET /user/timezone - Get current timezone
 * PUT /user/timezone - Set timezone
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, type PrismaClient } from '@tzurot/common-types';
import { requireUserAuth } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('user-timezone');

/**
 * Common timezone options for dropdown
 * Organized by region for better UX
 */
export const COMMON_TIMEZONES = [
  // Americas
  { value: 'America/New_York', label: 'Eastern Time (US)', offset: 'UTC-5' },
  { value: 'America/Chicago', label: 'Central Time (US)', offset: 'UTC-6' },
  { value: 'America/Denver', label: 'Mountain Time (US)', offset: 'UTC-7' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US)', offset: 'UTC-8' },
  { value: 'America/Anchorage', label: 'Alaska Time', offset: 'UTC-9' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time', offset: 'UTC-10' },
  { value: 'America/Toronto', label: 'Eastern Time (Canada)', offset: 'UTC-5' },
  { value: 'America/Vancouver', label: 'Pacific Time (Canada)', offset: 'UTC-8' },
  { value: 'America/Sao_Paulo', label: 'Brasília Time', offset: 'UTC-3' },
  { value: 'America/Mexico_City', label: 'Mexico City', offset: 'UTC-6' },
  // Europe
  { value: 'Europe/London', label: 'London (GMT/BST)', offset: 'UTC+0' },
  { value: 'Europe/Paris', label: 'Central European', offset: 'UTC+1' },
  { value: 'Europe/Berlin', label: 'Berlin', offset: 'UTC+1' },
  { value: 'Europe/Moscow', label: 'Moscow', offset: 'UTC+3' },
  // Asia
  { value: 'Asia/Dubai', label: 'Dubai', offset: 'UTC+4' },
  { value: 'Asia/Kolkata', label: 'India Standard', offset: 'UTC+5:30' },
  { value: 'Asia/Singapore', label: 'Singapore', offset: 'UTC+8' },
  { value: 'Asia/Shanghai', label: 'China Standard', offset: 'UTC+8' },
  { value: 'Asia/Tokyo', label: 'Japan Standard', offset: 'UTC+9' },
  { value: 'Asia/Seoul', label: 'Korea Standard', offset: 'UTC+9' },
  // Oceania
  { value: 'Australia/Sydney', label: 'Sydney', offset: 'UTC+10' },
  { value: 'Australia/Melbourne', label: 'Melbourne', offset: 'UTC+10' },
  { value: 'Pacific/Auckland', label: 'New Zealand', offset: 'UTC+12' },
  // Special
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)', offset: 'UTC+0' },
] as const;

/**
 * Validate timezone string
 */
function isValidTimezone(tz: string): boolean {
  // Check if it's in our common list
  if (COMMON_TIMEZONES.some(t => t.value === tz)) {
    return true;
  }

  // Try to validate using Intl API
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

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
          ErrorResponses.validationError(`Invalid timezone: ${timezone}. Use a valid IANA timezone.`)
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
      const tzInfo = COMMON_TIMEZONES.find(t => t.value === timezone);

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

  /**
   * GET /user/timezone/list
   * Get list of common timezones for UI dropdown
   */
  router.get('/list', (_req: Request, res: Response) => {
    sendCustomSuccess(
      res,
      {
        timezones: COMMON_TIMEZONES,
      },
      StatusCodes.OK
    );
  });

  return router;
}
