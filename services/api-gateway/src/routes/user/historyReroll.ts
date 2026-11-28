/**
 * Rerolling the latest assistant reply.
 *
 * POST /api/user/history/message/:messageId/reroll-check — preflight (reads only)
 * POST /api/user/history/message/:messageId/reroll       — commit the new reply
 * POST /api/user/history/message/:messageId/reroll-abort — undo a failed attempt
 *
 * The bot checks, generates a new reply (the worker writes the new memory and
 * reports its ids), edits the Discord message(s), then commits: the old row is
 * soft-deleted, a new row (deterministic id from the old row and the attempt)
 * takes its place, and the old reply's memories are removed in ONE
 * transaction. A failed attempt calls abort, which removes the memories the
 * attempt wrote.
 *
 * **Access control** mirrors `historyEdit.ts`: the bot owner may reroll any
 * reply; everyone else only rows whose persona they own, with the predicate in
 * the WHERE clause (404, never 403) on check and abort. Commit re-checks
 * everything the preflight checked rather than trusting it, and answers 409
 * ROW_CHANGED (not 404) for a row it cannot re-find under the owner scope.
 */

import { type Response, type RequestHandler } from 'express';
import type { Prisma } from '@tzurot/common-types/services/prisma';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import { MessageRole } from '@tzurot/common-types/constants/message';
import {
  RerollAbortRequestSchema,
  RerollAbortResponseSchema,
  RerollAssistantMessageRequestSchema,
  RerollAssistantMessageResponseSchema,
  RerollCheckRequestSchema,
  RerollCheckResponseSchema,
} from '@tzurot/common-types/schemas/api/history';
import { type IncognitoKind } from '@tzurot/common-types/types/schemas/message';
import { generateRerolledConversationHistoryUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { findImmediateTriggerRow, propagateDeletionToFacts } from '@tzurot/conversation-history';
import type { AuthenticatedRequest } from '../../types.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendContractSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';
import { resolveRequest } from './historyEdit.js';
import {
  abortRerollAttempt,
  findCommittedAttempt,
  storedIncognito,
  storedIncognitoKind,
} from './rerollAttempt.js';
import {
  AttemptAbortedError,
  MemoryBlockedError,
  RowChangedError,
  commitReroll,
  sweepAfterCommit,
  type CommitArgs,
  type RerollBody,
} from './rerollCommit.js';
import { readAttemptMemory } from './rerollJobResult.js';
import { planRerollMemoryRemoval, type RerollMemoryRemovalPlan } from './rerollMemoryPlan.js';

const logger = createLogger('user-history-reroll');

const NOT_FOUND_RESOURCE = 'Conversation history row for this message';

/** The columns the reroll routes read from the assistant row. */
const ROW_SELECT = {
  id: true,
  content: true,
  discordMessageId: true,
  personaId: true,
  personalityId: true,
  channelId: true,
  guildId: true,
  createdAt: true,
  messageMetadata: true,
  persona: { select: { ownerId: true, owner: { select: { discordId: true } } } },
} satisfies Prisma.ConversationHistorySelect;

type RerollRow = Prisma.ConversationHistoryGetPayload<{ select: typeof ROW_SELECT }>;

/** A 409 carrying the machine-readable subcode the bot branches on. */
function sendConflict(
  res: Response,
  code:
    | typeof API_ERROR_SUBCODE.NOT_LATEST
    | typeof API_ERROR_SUBCODE.ROW_CHANGED
    | typeof API_ERROR_SUBCODE.MEMORY_BLOCKED
    | typeof API_ERROR_SUBCODE.ATTEMPT_ABORTED,
  message: string
): void {
  sendError(res, { ...ErrorResponses.conflict(message), code });
}

/** The live assistant row holding this Discord message id, scoped by `ownerScope`. */
async function findRerollRowByMessage(
  prisma: RouteDeps['prisma'],
  messageId: string,
  ownerScope: Prisma.ConversationHistoryWhereInput
): Promise<RerollRow | null> {
  return prisma.conversationHistory.findFirst({
    where: {
      discordMessageId: { has: messageId },
      role: MessageRole.Assistant,
      deletedAt: null,
      ...ownerScope,
    },
    select: ROW_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

/**
 * Whether anything of any role (a user message, another reply) in this
 * channel and personality is newer than `row`. A reroll is refused then:
 * a turn may already be answering the old text. One named predicate so the
 * rule can be changed in one place.
 */
async function hasNewerRow(prisma: RouteDeps['prisma'], row: RerollRow): Promise<boolean> {
  const newer = await prisma.conversationHistory.findFirst({
    where: {
      channelId: row.channelId,
      personalityId: row.personalityId,
      deletedAt: null,
      id: { not: row.id },
      OR: [
        { createdAt: { gt: row.createdAt } },
        { createdAt: row.createdAt, role: MessageRole.Assistant, id: { gt: row.id } },
      ],
    },
    select: { id: true },
  });
  return newer !== null;
}

function optionalKind(kind: IncognitoKind | undefined): { incognitoKind?: IncognitoKind } {
  return kind === undefined ? {} : { incognitoKind: kind };
}

/** The user message the reply answered, or null for an untriggered reply. */
async function findTrigger(
  prisma: RouteDeps['prisma'],
  row: RerollRow
): Promise<{ discordMessageId: string; content: string; createdAt: string } | null> {
  const ids = await findImmediateTriggerRow(prisma, row);
  if (ids === null) {
    return null;
  }
  const trigger = await prisma.conversationHistory.findFirst({
    where: {
      channelId: row.channelId,
      personalityId: row.personalityId,
      personaId: row.personaId,
      role: MessageRole.User,
      discordMessageId: { hasSome: ids.discordMessageId },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { content: true, createdAt: true },
  });
  return trigger === null
    ? null
    : {
        discordMessageId: ids.discordMessageId[0],
        content: trigger.content,
        createdAt: trigger.createdAt.toISOString(),
      };
}

/** POST /api/user/history/message/:messageId/reroll-check */
export const handleCheckRerollAssistantMessage = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const resolved = resolveRequest(req, res);
    if (resolved === null) {
      return;
    }
    const parsed = RerollCheckRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }

    const row = await findRerollRowByMessage(prisma, resolved.messageId, resolved.ownerScope);
    if (row === null) {
      sendError(res, ErrorResponses.notFound(NOT_FOUND_RESOURCE));
      return;
    }
    if (await hasNewerRow(prisma, row)) {
      sendConflict(
        res,
        API_ERROR_SUBCODE.NOT_LATEST,
        'Only the latest reply in the channel can be rerolled'
      );
      return;
    }

    const memoryPlan = await planRerollMemoryRemoval(prisma, row, parsed.data);
    sendContractSuccess(res, RerollCheckResponseSchema, {
      rowId: row.id,
      personalityId: row.personalityId,
      personaId: row.personaId,
      ownerDiscordId: row.persona.owner.discordId,
      incognito: storedIncognito(row),
      ...optionalKind(storedIncognitoKind(row)),
      content: row.content,
      discordMessageIds: row.discordMessageId,
      trigger: await findTrigger(prisma, row),
      memoryPlan,
    });
  });
};

/** The incognito flag and kind the new row records: the body's when it names a flag, else the old row's. */
function resolveIncognito(
  body: RerollBody,
  row: RerollRow
): { incognito: boolean; incognitoKind: IncognitoKind | undefined } {
  if (body.incognito === undefined) {
    return { incognito: storedIncognito(row), incognitoKind: storedIncognitoKind(row) };
  }
  return { incognito: body.incognito, incognitoKind: body.incognitoKind };
}

/** Answer the 409 a commit-transaction rollback maps to; false when `error` is not one of them. */
function sendCommitConflict(res: Response, error: unknown): boolean {
  if (error instanceof RowChangedError) {
    sendConflict(res, API_ERROR_SUBCODE.ROW_CHANGED, 'The reply changed since the reroll began');
  } else if (error instanceof AttemptAbortedError) {
    sendConflict(res, API_ERROR_SUBCODE.ATTEMPT_ABORTED, 'This reroll attempt was already aborted');
  } else if (error instanceof MemoryBlockedError) {
    sendConflict(
      res,
      API_ERROR_SUBCODE.MEMORY_BLOCKED,
      "The reply's memory can no longer be replaced (locked)"
    );
  } else {
    return false;
  }
  return true;
}

/**
 * Plan the old reply's memory removal with the committing attempt's own
 * memories excluded. The attempt's ids come from the job's stored result; the
 * body's lists are the fallback when it can't vouch (`readAttemptMemory`).
 */
async function planCommit(
  prisma: RouteDeps['prisma'],
  row: RerollRow,
  body: RerollBody
): Promise<{
  plan: RerollMemoryRemovalPlan;
  attemptMemoryIds: string[];
  attemptPendingIds: string[];
  vouched: boolean;
}> {
  const recorded = await readAttemptMemory(prisma, {
    jobId: body.jobId,
    rowId: row.id,
    attemptId: body.attemptId,
  });
  const attemptMemoryIds = recorded?.memoryIds ?? body.newMemoryIds;
  const attemptPendingIds = recorded?.pendingIds ?? body.newPendingIds;
  const plan = await planRerollMemoryRemoval(prisma, row, {
    excludeMemoryIds: attemptMemoryIds,
    excludePendingIds: attemptPendingIds,
  });
  return { plan, attemptMemoryIds, attemptPendingIds, vouched: recorded !== null };
}

/** Run the commit transaction; a rollback that maps to a 409 answers it and returns null. */
async function commitOrConflict(res: Response, args: CommitArgs): Promise<number | null> {
  try {
    return await commitReroll(args);
  } catch (error) {
    if (sendCommitConflict(res, error)) {
      return null;
    }
    throw error;
  }
}

/** POST /api/user/history/message/:messageId/reroll */
export const handleRerollAssistantMessage = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const resolved = resolveRequest(req, res);
    if (resolved === null) {
      return;
    }
    const parsed = RerollAssistantMessageRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }
    const body = parsed.data;
    // The first stored id is the lookup key for Edit Response and Reroll; a row
    // that no longer carried the message it was found by would 404 on it.
    if (!body.discordMessageIds.includes(resolved.messageId)) {
      sendError(
        res,
        ErrorResponses.validationError('discordMessageIds must include the rerolled message id')
      );
      return;
    }

    // Re-found by id under the owner scope: the preflight is not trusted.
    const row = await prisma.conversationHistory.findFirst({
      where: {
        id: body.rowId,
        role: MessageRole.Assistant,
        deletedAt: null,
        ...resolved.ownerScope,
      },
      select: ROW_SELECT,
    });
    if (row?.discordMessageId.includes(resolved.messageId) !== true) {
      // A retry of a commit that already landed is a success, not a conflict.
      const landedId = await findCommittedAttempt(
        prisma,
        body.rowId,
        body.attemptId,
        resolved.ownerScope
      );
      if (landedId !== null) {
        sendContractSuccess(res, RerollAssistantMessageResponseSchema, {
          id: landedId,
          removedMemories: 0,
        });
        return;
      }
      sendConflict(res, API_ERROR_SUBCODE.ROW_CHANGED, 'The reply changed since the reroll began');
      return;
    }
    if (await hasNewerRow(prisma, row)) {
      sendConflict(
        res,
        API_ERROR_SUBCODE.NOT_LATEST,
        'A newer message arrived; the reroll was not applied'
      );
      return;
    }

    const { plan, attemptMemoryIds, attemptPendingIds, vouched } = await planCommit(
      prisma,
      row,
      body
    );
    if (plan.kind === 'blocked') {
      sendConflict(
        res,
        API_ERROR_SUBCODE.MEMORY_BLOCKED,
        `The reply's memory can no longer be replaced (${plan.reason})`
      );
      return;
    }

    const newId = generateRerolledConversationHistoryUuid(row.id, body.attemptId);
    const commitArgs: CommitArgs = {
      prisma,
      row,
      body,
      newId,
      ...resolveIncognito(body, row),
      memoryIds: plan.kind === 'remove' ? plan.memoryIds : [],
      pendingIds: plan.kind === 'remove' ? plan.pendingIds : [],
      attemptMemoryIds,
      attemptPendingIds,
      reviveOwnerId: vouched ? null : row.persona.ownerId,
    };
    const removedMemories = await commitOrConflict(res, commitArgs);
    if (removedMemories === null) {
      return;
    }
    if (removedMemories > 0) {
      await propagateDeletionToFacts(prisma);
    }
    logger.info(
      {
        oldRowId: row.id,
        newRowId: newId,
        removedMemories,
        ownerAccess: resolved.ownerAccess,
      },
      'Assistant reply rerolled'
    );
    sendContractSuccess(res, RerollAssistantMessageResponseSchema, { id: newId, removedMemories });
    // The answer is out: the abandoned-attempt sweep is best effort and neither
    // delays nor fails it (it logs its own failure and never throws).
    await sweepAfterCommit(commitArgs);
  });
};

/** POST /api/user/history/message/:messageId/reroll-abort */
export const handleAbortRerollAssistantMessage = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const resolved = resolveRequest(req, res);
    if (resolved === null) {
      return;
    }
    const parsed = RerollAbortRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendZodError(res, parsed.error);
      return;
    }
    const body = parsed.data;

    // Deleted or not: an abort may arrive after the row moved on.
    const row = await prisma.conversationHistory.findFirst({
      where: { id: body.rowId, role: MessageRole.Assistant, ...resolved.ownerScope },
      select: { personaId: true, personalityId: true, persona: { select: { ownerId: true } } },
    });
    if (row === null) {
      sendError(res, ErrorResponses.notFound(NOT_FOUND_RESOURCE));
      return;
    }

    // `keepMemoryIds` are rows the old reply owns that the new text deduped
    // onto (an identical reply); removing them would erase the old memory.
    const outcome = await abortRerollAttempt({
      prisma,
      rowId: body.rowId,
      attemptId: body.attemptId,
      jobId: body.jobId,
      ownerScope: resolved.ownerScope,
      row: {
        personaId: row.personaId,
        personalityId: row.personalityId,
        ownerId: row.persona.ownerId,
      },
      newMemoryIds: body.newMemoryIds,
      newPendingIds: body.newPendingIds,
      keepMemoryIds: body.keepMemoryIds,
    });
    logger.info(
      {
        rowId: body.rowId,
        removedMemories: outcome.removedMemories,
        committed: outcome.committed,
        oldRowLive: outcome.oldRowLive,
      },
      'Reroll aborted'
    );
    sendContractSuccess(res, RerollAbortResponseSchema, outcome);
  });
};
