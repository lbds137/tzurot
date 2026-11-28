/**
 * Keeps the long-term memory of one exchange in step with an edited assistant
 * reply.
 *
 * A memory keys on the TRIGGER (user) message id, not the reply's, and stores
 * `{user}: <message>\n{assistant}: <reply>`. So the memory for an edited reply
 * is found in two hops: the user row that triggered the reply, then the memory
 * whose `messageIds` contain that row's Discord id. A not-yet-stored exchange
 * lives in a `PendingMemory` row with the same text template and the same
 * trigger id in `metadata.messageIds`; the pending retry stores its text
 * verbatim, so that row must follow the edit too.
 *
 * Two steps: `planExchangeMemorySync` decides (read-only), and
 * `applyExchangeMemorySync` writes what the plan names. A blocked plan means the
 * edit must not happen, because memory would disagree with the history.
 */

import { findImmediateTriggerRow } from '@tzurot/conversation-history';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { rewriteReplyInExchangeText } from '@tzurot/common-types/utils/memoryReplyRewrite';
import { splitMemoryContent } from '@tzurot/common-types/utils/memoryContentSplit';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { writeMemoryContent } from './memorySingle.js';
import { findPrimaryRows, pendingMessageIds, storedReply } from './historyEditMemoryPrimary.js';
import {
  findSiblingCandidates,
  loadSiblingRows,
  memoryBlocker,
  type PlanExclusions,
  type PrimaryCoverage,
  type SiblingBlocker,
} from './historyEditMemorySiblings.js';

const logger = createLogger('user-history-edit-memory');

/** The edited reply row, as selected by the edit route's lookup. */
export interface EditedReplyRow {
  id: string;
  /**
   * The reply text as stored BEFORE the edit. Sibling memories are matched on
   * it, so a re-plan after the history write must still carry the pre-edit text.
   */
  content: string;
  channelId: string;
  personaId: string;
  personalityId: string;
  createdAt: Date;
}

/**
 * `off-template`: the stored text does not parse. `reply-off-template`: it
 * parses as stored, but not with the new reply in it.
 */
export type MemorySyncBlockReason =
  'locked' | 'other-locked' | 'chunked' | 'ambiguous' | 'off-template' | 'reply-off-template';

/** Rows to rewrite, the edited user's own first. */
export type ExchangeMemoryPlan =
  | { kind: 'none' }
  | { kind: 'sync'; memoryIds: string[]; pendingIds: string[] }
  | { kind: 'blocked'; reason: MemorySyncBlockReason };

/** What a plan leaves out of its queries, and whether it takes stale orphans along. */
export interface ExchangePlanOptions extends PlanExclusions {
  includeStaleOrphans?: boolean;
}

/** The block reason for a new reply that would make a stored text unparseable. */
const REPLY_OFF_TEMPLATE = 'reply-off-template' as const;

/**
 * Why `text` cannot follow an edit, or null when it can (to `newReply` when
 * given, else as stored).
 */
function templateBlock(
  text: string,
  newReply: string | undefined
): 'off-template' | 'reply-off-template' | null {
  if (splitMemoryContent(text) === null) {
    return 'off-template';
  }
  if (newReply !== undefined && rewriteReplyInExchangeText(text, newReply) === null) {
    return REPLY_OFF_TEMPLATE;
  }
  return null;
}

type PrimaryBlock = Extract<ExchangeMemoryPlan, { kind: 'blocked' }>['reason'];

/**
 * Why the primary rows cannot follow the edit, or null when they can. A stored
 * text that is itself unparseable outranks a reply-specific refusal: no reply
 * could fix it.
 */
function primaryBlockReason(
  memory: { isLocked: boolean; chunkGroupId: string | null; content: string } | undefined,
  pending: { text: string } | undefined,
  newReply: string | undefined
): PrimaryBlock | null {
  if (memory?.isLocked === true) {
    return 'locked';
  }
  if (memory !== undefined && memory.chunkGroupId !== null) {
    return 'chunked';
  }
  const blocks = [
    memory === undefined ? null : templateBlock(memory.content, newReply),
    pending === undefined ? null : templateBlock(pending.text, newReply),
  ].filter(block => block !== null);
  return blocks.find(block => block !== REPLY_OFF_TEMPLATE) ?? blocks.at(0) ?? null;
}

interface SiblingPlan {
  blocked: MemorySyncBlockReason | null;
  memoryIds: string[];
  pendingIds: string[];
}

function primaryCoverage(
  triggerIds: string[],
  memory: { id: string } | undefined,
  pending: { id: string } | undefined
): PrimaryCoverage {
  return { triggerIds, memoryId: memory?.id, pendingId: pending?.id };
}

/** A sibling row that holds the pre-edit reply, with what stops it being rewritten. */
interface SiblingMatch {
  id: string;
  text: string;
  blocker: SiblingBlocker;
}

/**
 * Plan the other memories of this reply (coalesced replies: other users', and
 * the editor's own earlier messages). A memory
 * or pending row is a sibling only when it belongs to a candidate's persona and
 * trigger AND holds exactly the pre-edit reply; one with a different reply is
 * another exchange and is ignored. One batched query per table, never one per
 * candidate.
 */
async function planSiblings(
  prisma: PrismaClient,
  row: EditedReplyRow,
  newReply: string | undefined,
  primary: PrimaryCoverage,
  exclusions: PlanExclusions
): Promise<SiblingPlan> {
  const none: SiblingPlan = { blocked: null, memoryIds: [], pendingIds: [] };
  const candidates = await findSiblingCandidates(prisma, row, primary.triggerIds);
  if (candidates.length === 0) {
    return none;
  }
  const { memories, pendings } = await loadSiblingRows(
    prisma,
    row.personalityId,
    candidates,
    primary,
    { ...exclusions, replyText: row.content }
  );

  const reasons = new Set<MemorySyncBlockReason>();
  const memoryIds = new Set<string>();
  const pendingIds = new Set<string>();
  const collect = (matches: SiblingMatch[], ids: Set<string>): void => {
    if (matches.length > 1) {
      reasons.add('ambiguous');
    }
    for (const match of matches) {
      ids.add(match.id);
      for (const reason of [match.blocker, templateBlock(match.text, newReply)]) {
        if (reason !== null) {
          reasons.add(reason);
        }
      }
    }
  };
  for (const candidate of candidates) {
    const owns = (personaId: string | null, ids: string[]): boolean =>
      personaId === candidate.personaId && ids.some(id => candidate.discordMessageId.includes(id));
    // Invariant: the history row's `content` equals the reply half of the memory
    // text, both written from the ai-worker's response content; the component
    // test "rewrites the other user memory and pending row" pins it. A row that
    // is the candidate's but holds a different reply is another exchange.
    const sameReply = (id: string, text: string): boolean => {
      const same = storedReply(text) === row.content;
      if (!same) {
        logger.debug(
          { rowId: row.id, candidatePersonaId: candidate.personaId, candidateRowId: id },
          'Sibling memory row holds a different reply; left alone'
        );
      }
      return same;
    };
    collect(
      memories
        .filter(
          memory =>
            owns(memory.personaId, memory.messageIds) && sameReply(memory.id, memory.content)
        )
        .map(memory => ({
          id: memory.id,
          text: memory.content,
          blocker: memoryBlocker(memory, row.personaId),
        })),
      memoryIds
    );
    collect(
      pendings
        .filter(
          pending =>
            owns(pending.personaId, pendingMessageIds(pending.metadata)) &&
            sameReply(pending.id, pending.text)
        )
        .map(pending => ({ id: pending.id, text: pending.text, blocker: null })),
      pendingIds
    );
  }

  // Same order as the primary: ambiguity, locks, chunking, then the reply itself.
  // (A matched sibling already parses as stored, so no stored `off-template`.)
  const order: MemorySyncBlockReason[] = [
    'ambiguous',
    'locked',
    'other-locked',
    'chunked',
    REPLY_OFF_TEMPLATE,
  ];
  return {
    blocked: order.find(reason => reasons.has(reason)) ?? null,
    memoryIds: [...memoryIds],
    pendingIds: [...pendingIds],
  };
}

/**
 * Decide how the exchange's memory follows an edit of `row`. Read-only.
 *
 * @param newReply when given, an edit that would make a stored text
 * unparseable is `off-template`; without it only the stored shape is checked.
 * @param options row ids to leave out of every query (primary, pending and
 * sibling): a reroll's freshly written memories, which carry the same trigger
 * id as the rows being replaced and must be neither planned nor counted as
 * ambiguity. `includeStaleOrphans` adds the unlocked, unchunked rows under the
 * same trigger that hold another reply and are older than the job lifetime
 * (a reroll's abandoned attempts) to a `sync` plan; Edit Response leaves them
 * alone, a reroll removes them.
 */
export async function planExchangeMemorySync(
  prisma: PrismaClient,
  row: EditedReplyRow,
  newReply?: string,
  options: ExchangePlanOptions = {}
): Promise<ExchangeMemoryPlan> {
  const { channelId, personalityId, personaId } = row;
  // personaId is scoped too: a shared channel can hold another persona's turn
  // just before this reply, and its memory is not this one.
  const trigger = await findImmediateTriggerRow(prisma, {
    channelId,
    personalityId,
    personaId,
    createdAt: row.createdAt,
  });

  if (trigger === null) {
    logger.debug({ rowId: row.id }, 'No trigger row for the edited reply; nothing to sync');
    return { kind: 'none' };
  }

  const { memories, pendings, orphanMemoryIds, orphanPendingIds, blocked } = await findPrimaryRows(
    prisma,
    row,
    trigger.discordMessageId,
    options
  );
  const orphans = options.includeStaleOrphans === true;

  if (blocked !== null) {
    logger.warn(
      { rowId: row.id, reason: blocked },
      'Exchange memory rows under the trigger cannot be told apart; edit blocked'
    );
    return { kind: 'blocked', reason: blocked };
  }

  if (memories.length > 1 || pendings.length > 1) {
    logger.warn(
      { rowId: row.id, memoryMatches: memories.length, pendingMatches: pendings.length },
      'Ambiguous exchange memory match; edit blocked'
    );
    return { kind: 'blocked', reason: 'ambiguous' };
  }
  const memory = memories.at(0);
  const pending = pendings.at(0);

  const reason = primaryBlockReason(memory, pending, newReply);
  if (reason !== null) {
    if (reason !== 'locked' && reason !== 'chunked') {
      logger.warn(
        { rowId: row.id, memoryId: memory?.id, pendingId: pending?.id, reason },
        'Exchange memory cannot follow the edit; edit blocked'
      );
    }
    return { kind: 'blocked', reason };
  }

  // The primary's reasons outrank the siblings': a block here is another
  // memory of the same coalesced reply (another user's, or the editor's own
  // earlier message).
  const siblings = await planSiblings(
    prisma,
    row,
    newReply,
    primaryCoverage(trigger.discordMessageId, memory, pending),
    options
  );
  if (siblings.blocked !== null) {
    logger.warn(
      { rowId: row.id, reason: siblings.blocked },
      'A sibling exchange memory cannot follow the edit; edit blocked'
    );
    return { kind: 'blocked', reason: siblings.blocked };
  }

  const memoryIds = [
    ...(memory === undefined ? [] : [memory.id]),
    ...siblings.memoryIds,
    ...(orphans ? orphanMemoryIds : []),
  ];
  const pendingIds = [
    ...(pending === undefined ? [] : [pending.id]),
    ...siblings.pendingIds,
    ...(orphans ? orphanPendingIds : []),
  ];
  if (memoryIds.length === 0 && pendingIds.length === 0) {
    return { kind: 'none' };
  }
  return { kind: 'sync', memoryIds, pendingIds };
}

/**
 * Write what a `sync` plan names. Each row is re-read by id so the rewrite
 * applies to its current text; a row that vanished or stopped matching the
 * template since planning is skipped with a warning.
 *
 * @returns whether every planned row was written; a skipped row is `false`.
 */
export async function applyExchangeMemorySync(
  prisma: PrismaClient,
  plan: Extract<ExchangeMemoryPlan, { kind: 'sync' }>,
  newReply: string
): Promise<boolean> {
  let allWritten = true;
  for (const memoryId of plan.memoryIds) {
    allWritten = (await applyMemory(prisma, memoryId, newReply)) && allWritten;
  }
  for (const pendingId of plan.pendingIds) {
    allWritten = (await applyPending(prisma, pendingId, newReply)) && allWritten;
  }
  return allWritten;
}

/** Rewrite one memory's reply; false when it vanished or stopped parsing. */
async function applyMemory(
  prisma: PrismaClient,
  memoryId: string,
  newReply: string
): Promise<boolean> {
  const memory = await prisma.memory.findUnique({
    where: { id: memoryId },
    select: { content: true },
  });
  const rewritten = memory === null ? null : rewriteReplyInExchangeText(memory.content, newReply);
  if (rewritten === null) {
    logger.warn({ memoryId }, 'Planned memory no longer rewritable; skipped');
    return false;
  }
  await writeMemoryContent(prisma, memoryId, rewritten);
  return true;
}

/** Rewrite one pending row's reply; false when it vanished or stopped parsing. */
async function applyPending(
  prisma: PrismaClient,
  pendingId: string,
  newReply: string
): Promise<boolean> {
  const pending = await prisma.pendingMemory.findUnique({
    where: { id: pendingId },
    select: { text: true },
  });
  const rewritten = pending === null ? null : rewriteReplyInExchangeText(pending.text, newReply);
  if (rewritten !== null) {
    // updateMany: the row can be consumed between the read above and this write,
    // and a vanished row must be a warned skip, not a thrown not-found.
    const { count } = await prisma.pendingMemory.updateMany({
      where: { id: pendingId },
      data: { text: rewritten },
    });
    if (count > 0) {
      return true;
    }
  }
  logger.warn({ pendingId }, 'Planned pending memory gone or unrewritable');
  return false;
}
