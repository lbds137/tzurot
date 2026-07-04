/**
 * POST /internal/channel/dm-session/set
 *
 * Service-only endpoint used by the bot-client's MultiTagCoordinator to
 * record the active personality in a DM channel after a multi-tag fan-out.
 * Mirrors `/user/channel/activate` semantically (writes to
 * `channel_settings`), but:
 *
 *   - No user-permission gate — the bot is acting on behalf of the DM
 *     participant whose own message just triggered the fan-out.
 *   - `guildId` is always `null` (DM channels have no guild).
 *   - Idempotent upsert — re-sending the same (channelId, personalitySlug)
 *     is a no-op.
 *
 * **Authentication**: `X-Service-Auth` enforcement happens upstream via the
 * global `app.use(requireServiceAuth())` in `api-gateway/src/index.ts`,
 * which gates every `/internal/*` route. Requests without a valid service
 * secret never reach this handler.
 *
 * Cache invalidation is client-side: the bot-client's
 * `GatewayClient.setDmSessionPersonality` calls
 * `invalidateChannelSettingsCache` after a successful response. The
 * user-facing `/user/channel/activate` endpoint follows the same pattern.
 * No server-side pub/sub fires from here.
 *
 * **Single-caller assumption**: client-side-only invalidation is correct
 * today because bot-client is the only caller. If a second service ever
 * calls this endpoint, the bot-client's local cache won't see the change
 * and will serve stale values until its 30s TTL expires. Adding a Redis
 * pub/sub broadcast here would close that gap; the trigger to do so is "a
 * second service legitimately needs to invoke this endpoint." Until then,
 * the simpler client-invalidation path is preferred.
 */

import { type Response, type RequestHandler } from 'express';
import { z } from 'zod';
import { generateChannelSettingsUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-dm-session-set');

const DmSessionSetRequestSchema = z.object({
  // Discord snowflake IDs are ≤19 chars; cap at 32 for headroom + defense
  // against absurdly long inputs at the service boundary.
  channelId: z.string().min(1).max(32),
  // Personality slugs match the DB column constraint (varchar(255)).
  personalitySlug: z.string().min(1).max(255),
});

/** POST /api/internal/channel/dm-session/set — record active personality in a DM channel. */
export const handleSetDmSession = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req, res: Response) => {
    const parseResult = DmSessionSetRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const { channelId, personalitySlug } = parseResult.data;

    const personality = await prisma.personality.findUnique({
      where: { slug: personalitySlug },
      select: { id: true },
    });
    if (personality === null) {
      sendError(res, ErrorResponses.notFound(`Personality "${personalitySlug}"`));
      return;
    }

    // Upsert with guildId: null. The `id` is deterministic per-channel so
    // repeated calls don't race-create duplicate rows.
    await prisma.channelSettings.upsert({
      where: { channelId },
      create: {
        id: generateChannelSettingsUuid(channelId),
        channelId,
        guildId: null,
        activatedPersonalityId: personality.id,
        // DM sessions always auto-respond — there's no user-facing opt-out
        // for the ambient path because the whole point of a session is
        // "this character keeps responding without me having to @ them."
        autoRespond: true,
        createdBy: null, // No user-id available in the internal-auth context
      },
      // `guildId` is not part of the update clause: DM channels always have
      // `guildId: null`, set at row creation; overwriting it on every update
      // is misleading (implies it could vary).
      update: { activatedPersonalityId: personality.id },
    });

    logger.debug({ channelId, personalitySlug }, 'DM session set');
    sendCustomSuccess(res, { channelId, personalitySlug });
  });
};
