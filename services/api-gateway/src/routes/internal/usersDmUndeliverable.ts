/**
 * POST /api/internal/users/dm-undeliverable
 *
 * Service-only endpoint. Records a permanent persona-DM delivery failure so
 * per-user unreachability stays fresh for the retention purge — the same
 * signal the notify pipeline's own delivery report produces via a release
 * blast. bot-client calls this from the reply path the moment a persona DM
 * classifies as permanently undeliverable (account gone, DMs closed, no
 * shared server).
 *
 * The error-code -> column mapping (dm_undeliverable_since vs.
 * discord_account_gone_at, and which codes stamp nothing) lives entirely in
 * `stampDmPermanentFailure` — this handler only resolves the user row and
 * forwards the code.
 *
 * Authentication: X-Service-Auth is enforced upstream by the global
 * requireServiceAuth() in api-gateway/src/index.ts, which gates every
 * /internal/* route. Requests without a valid service secret never reach here.
 */

import { type Response, type RequestHandler } from 'express';
import {
  StampUserDmUndeliverableRequestSchema,
  StampUserDmUndeliverableResponseSchema,
} from '@tzurot/common-types/schemas/api/internal';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendContractSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { stampDmPermanentFailure } from '../../services/retention/dmFailureStamps.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-users-dm-undeliverable');

/** POST /api/internal/users/dm-undeliverable — stamp a permanent persona-DM failure. */
export const handleStampUserDmUndeliverable = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req, res: Response) => {
    const parseResult = StampUserDmUndeliverableRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const { discordId, errorCode } = parseResult.data;

    const user = await prisma.user.findUnique({
      // eslint-disable-next-line no-restricted-syntax -- Service-to-service route with no provisioned-user context: the target is the DM recipient named in the body, so a cross-user lookup by discordId is the only lookup possible
      where: { discordId },
      select: { id: true },
    });
    if (user === null) {
      // An unprovisioned DM target has no row to stamp — a legitimate no-op,
      // not an error, exactly as the activity route treats a 0-row update.
      sendContractSuccess(res, StampUserDmUndeliverableResponseSchema, { stamped: false });
      return;
    }

    const affected = await stampDmPermanentFailure(prisma, user.id, errorCode);

    logger.debug(
      { discordId, errorCode, stamped: affected > 0 },
      'Stamped persona-DM unreachability'
    );
    sendContractSuccess(res, StampUserDmUndeliverableResponseSchema, { stamped: affected > 0 });
  });
};
