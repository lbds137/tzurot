/**
 * What a reroll result hands the gateway: the memory ids the worker reported and
 * the commit request body. Pure functions of the generation result, split out of
 * `rerollResultHandler.ts` so the delivery flow stays under the file-size limit.
 */

import { REROLL_MAX_THINKING_LENGTH } from '@tzurot/common-types/constants/discord';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { RerollPreflight } from '../services/character/rerollTurn.js';
import type { RerollJobContext } from '../services/JobTracker.js';
import type { BegunEdit } from '../utils/editResponse/discordEdit.js';
import type { clientsForUser } from '../utils/gatewayClients.js';

/** The memory rows the worker wrote for the new reply (empty when none reported). */
export function reportedMemory(result: LLMGenerationResult): {
  newMemoryIds: string[];
  newPendingIds: string[];
} {
  return {
    newMemoryIds: result.metadata?.rerollMemory?.memoryIds ?? [],
    newPendingIds: result.metadata?.rerollMemory?.pendingIds ?? [],
  };
}

export interface CommitBodyArgs {
  jobId: string;
  ctx: RerollJobContext;
  result: LLMGenerationResult;
  current: RerollPreflight;
  content: string;
  applied: BegunEdit;
}

/** The commit request: the new text and ids, the incognito state the new generation reported. */
export function buildCommitBody(
  args: CommitBodyArgs
): Parameters<ReturnType<typeof clientsForUser>['userClient']['rerollAssistantMessage']>[1] {
  const { ctx, result, current } = args;
  const incognito = result.metadata?.incognitoModeActive ?? current.incognito;
  const incognitoKind = incognito
    ? (result.metadata?.incognitoKind ?? current.incognitoKind)
    : undefined;
  return {
    rowId: ctx.rowId,
    attemptId: ctx.attemptId,
    jobId: args.jobId,
    content: args.content,
    discordMessageIds: args.applied.messageIds,
    thinkingContent: boundedTrace(result.metadata?.thinkingContent),
    incognito,
    ...(incognitoKind !== undefined ? { incognitoKind } : {}),
    ...reportedMemory(result),
  };
}

/** The reasoning trace for the commit; one over the body bound is dropped (a 400 would undo the reroll). */
function boundedTrace(trace: string | undefined): string | null {
  return trace === undefined || trace.length > REROLL_MAX_THINKING_LENGTH ? null : trace;
}
