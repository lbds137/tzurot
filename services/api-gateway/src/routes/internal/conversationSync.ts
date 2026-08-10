/**
 * POST /api/internal/conversation/sync
 *
 * Opportunistic edit/delete sync. bot-client ships the Discord snapshot it
 * fetched for a channel+personality; the gateway runs the diff against DB
 * state and applies the writes (content updates, soft-deletes).
 *
 * The algorithm lives in ConversationSyncService.runSync
 * (@tzurot/conversation-history); this endpoint is its only caller.
 * Idempotent: re-posting an already-applied snapshot finds zero work, so
 * at-least-once delivery of the same snapshot is harmless.
 *
 * **Authentication**: `X-Service-Auth` enforcement happens upstream via the
 * global `requireServiceAuth()` on `/internal/*` in api-gateway's index.
 */

import { type Response, type RequestHandler } from 'express';
import {
  ConversationSyncRequestSchema,
  ConversationSyncResponseSchema,
  type ConversationSyncResponse,
} from '@tzurot/common-types/schemas/api/internal';
import { ConversationSyncService } from '@tzurot/conversation-history';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendContractSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

/** POST /api/internal/conversation/sync — apply edit/delete sync from a Discord snapshot. */
export const handleSyncConversation = (deps: RouteDeps): RequestHandler => {
  const syncService = new ConversationSyncService(deps.prisma);

  return asyncHandler(async (req, res: Response) => {
    const parseResult = ConversationSyncRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const { channelId, personalityId, observedMessages } = parseResult.data;

    // runSync logs nonzero results itself ('Opportunistic sync completed',
    // with channelId + personalityId) — no handler-side log needed.
    const result = await syncService.runSync(
      channelId,
      personalityId,
      observedMessages.map(m => ({
        id: m.discordMessageId,
        content: m.content,
        createdAt: new Date(m.createdAt),
      }))
    );

    sendContractSuccess(
      res,
      ConversationSyncResponseSchema,
      result satisfies ConversationSyncResponse
    );
  });
};
