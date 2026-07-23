/**
 * POST /internal/users/activity
 *
 * Service-only endpoint. Records a "the user is active" signal for slash
 * commands that never otherwise reach the gateway — pure-client commands like
 * /help render entirely bot-side, so without this their use would never refresh
 * the retention clock. Stamps the same pair the getOrCreateUser provisioning
 * path maintains: refresh last_active_at and clear dm_undeliverable_since
 * (activity is proof of reach), keyed by Discord ID.
 *
 * Best-effort: a raw UPDATE that no-ops (0 rows) when the user isn't
 * provisioned yet — a pure-client-only user has no row and no data to track, so
 * "not found" is a legitimate outcome, not an error. Raw SQL (not the Prisma
 * client) so `updated_at` (the dev<->prod sync LWW resolver) stays untouched —
 * identical reasoning to the UserService.getOrCreateUser lastActiveAt stamp.
 *
 * Authentication: X-Service-Auth is enforced upstream by the global
 * requireServiceAuth() in api-gateway/src/index.ts, which gates every
 * /internal/* route. Requests without a valid service secret never reach here.
 */

import { type Response, type RequestHandler } from 'express';
import { StampUserActivityRequestSchema } from '@tzurot/common-types/schemas/api/internal';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-users-activity');

/** POST /api/internal/users/activity — refresh the caller's retention activity signal. */
export const handleStampUserActivity = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req, res: Response) => {
    const parseResult = StampUserActivityRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const { discordId } = parseResult.data;

    // Raw UPDATE (not the Prisma client): last_active_at and
    // dm_undeliverable_since are retention signals that must NOT bump
    // updated_at (the dev<->prod sync LWW resolver) — see
    // UserService.getOrCreateUser for the full rationale. `$executeRaw` returns
    // the affected-row count, which is 0 when the user isn't provisioned yet
    // (a legitimate no-op, not an error).
    const affected = await prisma.$executeRaw`
      UPDATE users SET last_active_at = NOW(), dm_undeliverable_since = NULL WHERE discord_id = ${discordId}
    `;

    logger.debug({ discordId, stamped: affected > 0 }, 'Stamped pure-client user activity');
    sendCustomSuccess(res, { stamped: affected > 0 });
  });
};
