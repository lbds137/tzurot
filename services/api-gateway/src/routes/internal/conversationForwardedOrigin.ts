/**
 * POST /api/internal/conversation/forwarded-origin
 *
 * Backfills a forwarded message's recovered origin onto its already-persisted
 * user row.
 *
 * Separate from the persist endpoint because recovering the origin costs
 * Discord REST round-trips — bot-client must re-fetch the message the forward
 * points at, since Discord's `message_snapshots` carry neither `author` nor
 * `id`. Doing that inline would put those round-trips on the path that gates
 * AI job submission, so the row is written first and attributed after.
 *
 * The row is addressed by re-deriving the SAME deterministic id the persist
 * used — a pure function of (channelId, personalityId, personaId,
 * messageTime). Deriving it here rather than accepting an id from the caller
 * keeps one owner of that derivation, so the two endpoints cannot drift into
 * addressing different rows.
 *
 * A miss is reported as `updated: false`, not an error: the persist is
 * best-effort bot-side, so "no such row" is an ordinary outcome.
 *
 * **Authentication**: `X-Service-Auth` enforcement happens upstream via the
 * global `requireServiceAuth()` on `/internal/*` in api-gateway's index.
 */

import { type Response, type RequestHandler } from 'express';
import {
  PatchForwardedOriginRequestSchema,
  PatchForwardedOriginResponseSchema,
} from '@tzurot/common-types/schemas/api/internal';
import { generateConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { mergeForwardedOrigin } from '@tzurot/conversation-history';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendContractSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-conversation-forwarded-origin');

/** POST /api/internal/conversation/forwarded-origin — attribute a forwarded row. */
export const handlePatchForwardedOrigin = (deps: RouteDeps): RequestHandler => {
  // The MAIN pool, deliberately, where the persist next door prefers the fast
  // one. Two reasons point the same way: `fastPrisma` is typed as the narrow
  // ConversationHistoryClient and cannot issue the raw statement this needs,
  // and the whole point of this endpoint is that it is OFF the latency path —
  // so it has no claim on the pool reserved for writes a user waits on.
  const { prisma } = deps;

  return asyncHandler(async (req, res: Response) => {
    const parseResult = PatchForwardedOriginRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }

    const { channelId, personalityId, personaId, messageTime, forwardedFrom } = parseResult.data;
    const id = generateConversationHistoryUuid(
      channelId,
      personalityId,
      personaId,
      new Date(messageTime)
    );

    const updated = await mergeForwardedOrigin(prisma, id, forwardedFrom);

    if (!updated) {
      logger.debug(
        { id, channelId },
        'Forwarded-origin backfill matched no row; quote stays unattributed'
      );
    }

    sendContractSuccess(res, PatchForwardedOriginResponseSchema, { updated });
  });
};
