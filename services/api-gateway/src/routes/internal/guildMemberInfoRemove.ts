/**
 * DELETE /api/internal/guild-member-info
 *
 * Removes a user's stored guild membership when they leave a guild. bot-client
 * calls this from its `guildMemberRemove` listener so a departed member stops
 * rendering in `<participants>` instead of lingering as stale last-known state.
 *
 * The endpoint exists at all because bot-client is Prisma-free: it is the only
 * service that can see Discord events, and the only one that cannot write them.
 *
 * **Authentication**: `X-Service-Auth` is enforced upstream by the global
 * `requireServiceAuth()` in `api-gateway/src/index.ts`, which gates every
 * `/internal/*` route.
 *
 * **Never provisions a user.** A departure fires for members who have never
 * touched the bot, and an unknown Discord id reports `deleted: false` and
 * writes nothing. This is deletion on an explicit end-of-membership event,
 * never expiry — nothing here runs on a clock.
 */

import { type Response, type RequestHandler } from 'express';
import {
  GuildMemberInfoRemoveRequestSchema,
  GuildMemberInfoRemoveResponseSchema,
} from '@tzurot/common-types/schemas/api/internal';
import { deleteGuildMemberInfo } from '@tzurot/common-types/services/guildMemberInfoStore';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendContractSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-guild-member-info-remove');

/** DELETE /api/internal/guild-member-info — remove one member's stored guild info. */
export const handleRemoveGuildMemberInfo = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req, res: Response) => {
    const parseResult = GuildMemberInfoRemoveRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const { guildId, discordUserId } = parseResult.data;

    // There is no provisioned user on this request to read instead: the route is
    // service-only, and the id it carries names whichever guild member Discord
    // just emitted a departure event about. The null branch below is
    // load-bearing, which is the other half of why `resolveProvisionedUserId`
    // is wrong here — it provisions, and this path must not.
    const user = await prisma.user.findUnique({
      // eslint-disable-next-line no-restricted-syntax -- Service-only route with no human actor: the id names an arbitrary guild member rather than the caller, and this lookup must not provision
      where: { discordId: discordUserId },
      select: { id: true },
    });
    if (user === null) {
      sendContractSuccess(res, GuildMemberInfoRemoveResponseSchema, { deleted: false });
      return;
    }

    const count = await deleteGuildMemberInfo(prisma, guildId, user.id);

    logger.debug({ guildId, deleted: count > 0 }, 'Guild member info removal processed');
    sendContractSuccess(res, GuildMemberInfoRemoveResponseSchema, { deleted: count > 0 });
  });
};
