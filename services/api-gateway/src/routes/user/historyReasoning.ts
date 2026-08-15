/**
 * GET /api/user/history/reasoning/:messageId
 *
 * The persisted reasoning trace for one assistant turn, looked up by any of
 * the turn's Discord chunk message IDs. This is the long-lived counterpart to
 * the diagnostic-log lookup: `llm_diagnostic_logs` is purged at 24h, while the
 * trace persisted on the conversation-history row lives for the full history
 * retention window and dies with its row.
 *
 * **Access control** is enforced HERE, server-side, and mirrors the diagnostic
 * routes' owner-or-own-rows shape: the bot owner reads any row; everyone else
 * only rows whose persona they own. The ownership predicate is pushed into the
 * WHERE clause rather than applied after the fetch, so a row the caller cannot
 * see is never loaded and never distinguishable from a missing one — the same
 * 404-not-403 existence-hiding the diagnostic lookups use.
 */

import { type Response, type RequestHandler } from 'express';
import { MessageRole, ASSISTANT_ROW_OFFSET_MS } from '@tzurot/common-types/constants/message';
import { MessageReasoningResponseSchema } from '@tzurot/common-types/schemas/api/history';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import type { AuthenticatedRequest } from '../../types.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendContractSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('user-history-reasoning');

/**
 * Fail-closed guard for a missing caller identity. Mirrors the diagnostic
 * routes': without it, a middleware regression that dropped `req.userId` would
 * silently turn the per-user WHERE filter into "no filter" — every user's
 * traces readable by anyone. A 500 is the correct outcome, not a bare fetch.
 */
const MISSING_CALLER_IDENTITY = 'Missing caller identity';

/** What the lookup returns either way — the trace plus the row's age. */
interface ResolvedTrace {
  thinkingContent: string | null;
  createdAt: Date;
}

/**
 * The direct path: the id belongs to the assistant's own reply, which is what
 * a right-click on the bot's message gives us.
 */
async function findTraceByReplyId(
  prisma: RouteDeps['prisma'],
  messageId: string,
  ownerScope: object
): Promise<ResolvedTrace | null> {
  return prisma.conversationHistory.findFirst({
    where: {
      discordMessageId: { has: messageId },
      // Only assistant turns carry a trace.
      role: MessageRole.Assistant,
      // A soft-deleted turn is gone from the user's view everywhere else;
      // surfacing its reasoning here would be a back door around that.
      deletedAt: null,
      ...ownerScope,
    },
    select: { thinkingContent: true, createdAt: true },
    // Deterministic tiebreak if a message id ever appears on two rows.
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Resolve a TRIGGER message id to the assistant turn that answered it.
 *
 * Two hops, because a user turn and its reply are separate rows with separate
 * Discord message ids: find the user row by its own id, then the reply paired
 * with it. "Paired" is an EXACT timestamp match, not a range scan — the
 * assistant row is persisted at `userMessageTime + 1ms`
 * (`conversationAssistantMessage.ts` derives it that way so the row's id is a
 * pure function of the turn), so its `createdAt` is exactly one millisecond
 * past the user row's.
 *
 * The exactness is the point, and it is a SAFETY property rather than an
 * optimization. A reply can legitimately have no row at all: `SlotDeliveryService`
 * persists AFTER the webhook send and deliberately swallows failures, so the
 * user can hold a message that was never written. A range scan
 * (`createdAt > userRow.createdAt`, take the first) answers that case with
 * whatever unrelated turn came next and renders its reasoning under the wrong
 * message. The exact match answers it with nothing.
 *
 * That also makes this robust to the one thing not verified here: whether
 * `userMessageTime` is the Discord post time on EVERY producer path (the job
 * context, and `MultiTagRecovery` rebuilding it from a snapshot). If it ever
 * isn't, this misses and the caller 404s — which is where the user was before
 * the bridge existed. Wrong-and-confident is the failure worth engineering out;
 * see TASK-619 for the producer sweep that would let this be asserted rather
 * than merely relied upon.
 *
 * `ownerScope` is applied to BOTH hops, not just the first. Skipping it on the
 * second would let a caller who owns a user row read a reply belonging to
 * someone else, which is the same leak the direct path closes.
 *
 * Returns null when either hop misses; the caller renders that as the ordinary
 * 404, so a bridge miss is indistinguishable from an unknown message id.
 */
async function bridgeFromTriggerMessage(
  prisma: RouteDeps['prisma'],
  messageId: string,
  ownerScope: object
): Promise<ResolvedTrace | null> {
  const userRow = await prisma.conversationHistory.findFirst({
    where: {
      discordMessageId: { has: messageId },
      role: MessageRole.User,
      deletedAt: null,
      ...ownerScope,
    },
    select: { channelId: true, personalityId: true, personaId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  if (userRow === null) {
    return null;
  }

  return prisma.conversationHistory.findFirst({
    where: {
      channelId: userRow.channelId,
      personalityId: userRow.personalityId,
      personaId: userRow.personaId,
      role: MessageRole.Assistant,
      // Exactly the paired reply — see the note above on why this is an
      // equality and not a range.
      createdAt: new Date(userRow.createdAt.getTime() + ASSISTANT_ROW_OFFSET_MS),
      deletedAt: null,
      ...ownerScope,
    },
    select: { thinkingContent: true, createdAt: true },
  });
}

/** GET /api/user/history/reasoning/:messageId — persisted trace for an assistant turn. */
export const handleGetMessageReasoning = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const callerUserId = req.userId;
    if (callerUserId === undefined || callerUserId === '') {
      sendError(res, ErrorResponses.internalError(MISSING_CALLER_IDENTITY));
      return;
    }
    const ownerAccess = isBotOwner(callerUserId);

    const messageId = getParam(req.params.messageId);
    if (messageId === undefined || messageId === '') {
      sendError(res, ErrorResponses.validationError('Message ID is required'));
      return;
    }

    // The gate, applied identically to every query below. Non-owners see only
    // rows whose persona they own; the bot owner sees all.
    const ownerScope = ownerAccess ? {} : { persona: { owner: { discordId: callerUserId } } };

    const row = await findTraceByReplyId(prisma, messageId, ownerScope);

    // Both click targets must work, because the diagnostic tier this falls back
    // FROM accepts both: `lookupByMessageId` tries by-message then by-response,
    // so a user who right-clicks their own prompt gets an answer within 24h.
    // Without this bridge they would stop getting one the moment the diagnostic
    // expires — the exact window this column exists to cover — while the reply's
    // trace sits in the same table under the reply's ID.
    const resolved = row ?? (await bridgeFromTriggerMessage(prisma, messageId, ownerScope));

    if (resolved === null) {
      sendError(res, ErrorResponses.notFound('Conversation history row for this message'));
      return;
    }

    logger.debug(
      {
        messageId,
        ownerAccess,
        hasTrace: resolved.thinkingContent !== null,
        viaTriggerBridge: row === null,
      },
      'Retrieved persisted reasoning trace'
    );

    // Contract, not custom: the route has a manifest entry declaring
    // `MessageReasoningResponseSchema`, so anchoring the payload against it
    // here makes a future shape drift a `tsc` failure rather than something the
    // client's runtime parse discovers.
    sendContractSuccess(res, MessageReasoningResponseSchema, {
      thinkingContent: resolved.thinkingContent,
      createdAt: resolved.createdAt.toISOString(),
    });
  });
};
