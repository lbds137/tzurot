/**
 * POST /api/internal/guild-member-info
 *
 * Records a user's last-known guild membership so `<participants>` renders
 * identical bytes from turn to turn. bot-client calls this from its
 * `guildMemberUpdate` listener — the one refresh source that is genuinely
 * event-driven; every other write happens opportunistically in ai-worker when
 * a turn's envelope happens to carry an observation.
 *
 * The endpoint exists at all because bot-client is Prisma-free: it is the only
 * service that can see Discord events, and the only one that cannot write them.
 *
 * **Authentication**: `X-Service-Auth` is enforced upstream by the global
 * `requireServiceAuth()` in `api-gateway/src/index.ts`, which gates every
 * `/internal/*` route.
 *
 * **Never provisions a user.** A role change fires for members who have never
 * touched the bot, and creating a row for each would turn an unrelated guild's
 * admin housekeeping into user growth. An unknown Discord id reports
 * `recorded: false` and writes nothing.
 */

import { type Response, type RequestHandler } from 'express';
import {
  GuildMemberInfoRecordRequestSchema,
  GuildMemberInfoRecordResponseSchema,
} from '@tzurot/common-types/schemas/api/internal';
import { recordGuildMemberInfos } from '@tzurot/common-types/services/guildMemberInfoStore';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendContractSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-guild-member-info');

/** POST /api/internal/guild-member-info — refresh one member's stored guild info. */
export const handleRecordGuildMemberInfo = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req, res: Response) => {
    const parseResult = GuildMemberInfoRecordRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const { guildId, discordUserId, info } = parseResult.data;

    // There is no provisioned user on this request to read instead: the route is
    // service-only, and the id it carries names whichever guild member Discord
    // just emitted an event about. The null branch below is load-bearing, which
    // is the other half of why `resolveProvisionedUserId` is wrong here — it
    // provisions, and this path must not.
    const user = await prisma.user.findUnique({
      // eslint-disable-next-line no-restricted-syntax -- Service-only route with no human actor: the id names an arbitrary guild member rather than the caller, and this lookup must not provision
      where: { discordId: discordUserId },
      select: { id: true },
    });
    if (user === null) {
      sendContractSuccess(res, GuildMemberInfoRecordResponseSchema, { recorded: false });
      return;
    }

    await recordGuildMemberInfos(prisma, guildId, [{ userId: user.id, info }]);

    logger.debug({ guildId, roleCount: info.roles.length }, 'Guild member info recorded');
    sendContractSuccess(res, GuildMemberInfoRecordResponseSchema, { recorded: true });
  });
};
