/**
 * Editing an assistant reply.
 *
 * GET   /api/user/history/editable/:messageId — stored text + chunk ids
 * PATCH /api/user/history/message/:messageId  — replace the stored text
 *
 * **Access control** mirrors `historyReasoning.ts`: the bot owner may edit any
 * reply; everyone else only rows whose persona they own. The predicate is in
 * the WHERE clause, so a row the caller cannot edit is never loaded and is
 * indistinguishable from a missing one (404, not 403). The PATCH re-runs the
 * lookup rather than trusting an earlier GET.
 */

import { type Response, type RequestHandler } from 'express';
import type { z } from 'zod';
import type { Prisma } from '@tzurot/common-types/services/prisma';
import { MessageRole } from '@tzurot/common-types/constants/message';
import {
  EditableMessageResponseSchema,
  EditAssistantMessageRequestSchema,
  EditAssistantMessageResponseSchema,
  EditCheckRequestSchema,
} from '@tzurot/common-types/schemas/api/history';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import type { AuthenticatedRequest } from '../../types.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendContractSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { getParam } from '../../utils/requestParams.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';
import { applyExchangeMemorySync, planExchangeMemorySync } from './historyEditMemory.js';

const logger = createLogger('user-history-edit');

/** Fail-closed guard for a missing caller identity (see historyReasoning.ts). */
const MISSING_CALLER_IDENTITY = 'Missing caller identity';

const NOT_FOUND_RESOURCE = 'Conversation history row for this message';

/** The columns the edit routes read from the assistant row. */
interface EditableRow {
  id: string;
  content: string;
  discordMessageId: string[];
  personaId: string;
  personalityId: string;
  channelId: string;
  createdAt: Date;
}

/**
 * The editable assistant row for a Discord message id, scoped by `ownerScope`.
 * Soft-deleted rows are excluded: they are gone from the user's view.
 */
async function findEditableRow(
  prisma: RouteDeps['prisma'],
  discordMessageId: string,
  ownerScope: Prisma.ConversationHistoryWhereInput
): Promise<EditableRow | null> {
  return prisma.conversationHistory.findFirst({
    where: {
      discordMessageId: { has: discordMessageId },
      role: MessageRole.Assistant,
      deletedAt: null,
      ...ownerScope,
    },
    select: {
      id: true,
      content: true,
      discordMessageId: true,
      personaId: true,
      personalityId: true,
      channelId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/** Resolve the caller and message id; sends the error and returns null on failure. */
function resolveRequest(
  req: AuthenticatedRequest,
  res: Response
): {
  messageId: string;
  ownerScope: Prisma.ConversationHistoryWhereInput;
  ownerAccess: boolean;
} | null {
  const callerUserId = req.userId;
  if (callerUserId === undefined || callerUserId === '') {
    sendError(res, ErrorResponses.internalError(MISSING_CALLER_IDENTITY));
    return null;
  }
  const ownerAccess = isBotOwner(callerUserId);

  const messageId = getParam(req.params.messageId);
  if (messageId === undefined || messageId === '') {
    sendError(res, ErrorResponses.validationError('Message ID is required'));
    return null;
  }

  const ownerScope = ownerAccess ? {} : { persona: { owner: { discordId: callerUserId } } };
  return { messageId, ownerScope, ownerAccess };
}

/**
 * The editable payload for `row`, with the memory plan made against the real
 * stored texts (and `newReply` when given).
 */
async function buildEditablePayload(
  prisma: RouteDeps['prisma'],
  row: EditableRow,
  newReply?: string
): Promise<z.infer<typeof EditableMessageResponseSchema>> {
  const plan = await planExchangeMemorySync(prisma, row, newReply);
  return {
    content: row.content,
    discordMessageIds: row.discordMessageId,
    personalityId: row.personalityId,
    // Row ids stay server-side: only the kind (and block reason) cross the wire.
    memorySync: plan.kind === 'blocked' ? plan : { kind: plan.kind },
  };
}

/** GET /api/user/history/editable/:messageId */
export const handleGetEditableMessage = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const resolved = resolveRequest(req, res);
    if (resolved === null) {
      return;
    }

    const row = await findEditableRow(prisma, resolved.messageId, resolved.ownerScope);
    if (row === null) {
      sendError(res, ErrorResponses.notFound(NOT_FOUND_RESOURCE));
      return;
    }

    // No new reply here: this checks the stored shape only. The submit-time
    // check is `handleCheckEditAssistantMessage`.
    sendContractSuccess(
      res,
      EditableMessageResponseSchema,
      await buildEditablePayload(prisma, row)
    );
  });
};

/** POST /api/user/history/message/:messageId/edit-check */
export const handleCheckEditAssistantMessage = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const resolved = resolveRequest(req, res);
    if (resolved === null) {
      return;
    }

    const parsed = EditCheckRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }

    const row = await findEditableRow(prisma, resolved.messageId, resolved.ownerScope);
    if (row === null) {
      sendError(res, ErrorResponses.notFound(NOT_FOUND_RESOURCE));
      return;
    }

    sendContractSuccess(
      res,
      EditableMessageResponseSchema,
      await buildEditablePayload(prisma, row, parsed.data.content)
    );
  });
};

/** PATCH /api/user/history/message/:messageId */
export const handleEditAssistantMessage = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const resolved = resolveRequest(req, res);
    if (resolved === null) {
      return;
    }

    const parsed = EditAssistantMessageRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }
    const { content, discordMessageIds } = parsed.data;

    // Authorization is re-checked here, not inherited from an earlier GET.
    const row = await findEditableRow(prisma, resolved.messageId, resolved.ownerScope);
    if (row === null) {
      sendError(res, ErrorResponses.notFound(NOT_FOUND_RESOURCE));
      return;
    }

    // The first chunk is the stable route key and is never deleted; a list that
    // starts elsewhere would orphan the row's lookup key.
    if (discordMessageIds[0] !== row.discordMessageId[0]) {
      sendError(
        res,
        ErrorResponses.validationError('The first message id must match the stored reply')
      );
      return;
    }

    // Same semantics as ConversationSyncService.updateMessageContent, plus the
    // chunk-id list, which may have grown or shrunk with the edit.
    await prisma.conversationHistory.update({
      where: { id: row.id },
      data: {
        content,
        tokenCount: countTextTokens(content),
        editedAt: new Date(),
        discordMessageId: discordMessageIds,
      },
    });

    // The history row is the source of truth and is already saved; a memory
    // failure must not turn a completed edit into an error.
    // The bot refuses a blocked edit before touching Discord, so a blocked plan
    // here means the memory changed after that preflight (a race).
    let memory: z.infer<typeof EditAssistantMessageResponseSchema>['memory'] = { kind: 'none' };
    try {
      // `row` is the pre-update select, so `row.content` is the pre-edit text
      // that sibling memories of a coalesced reply are matched on.
      const plan = await planExchangeMemorySync(prisma, row, content);
      if (plan.kind === 'blocked') {
        logger.warn(
          { rowId: row.id, reason: plan.reason },
          'Exchange memory became unsyncable after the edit preflight; memory left as-is'
        );
        memory = plan;
      } else if (plan.kind === 'sync') {
        memory = (await applyExchangeMemorySync(prisma, plan, content))
          ? { kind: 'synced' }
          : { kind: 'failed' };
      }
    } catch (error) {
      logger.error({ err: error, rowId: row.id }, 'Exchange memory sync failed');
      memory = { kind: 'failed' };
    }

    logger.info(
      { rowId: row.id, ownerAccess: resolved.ownerAccess, memory: memory.kind },
      'Assistant reply edited'
    );
    sendContractSuccess(res, EditAssistantMessageResponseSchema, { edited: true, memory });
  });
};
