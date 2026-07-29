/**
 * Pure helpers for MultiTagCoordinator. Extracted into a sibling file so
 * the coordinator stays under the 400-line `max-lines` cap and so these
 * projections can be unit-tested independently if desired.
 *
 * - `buildSlotContext`: project a runtime slot + its parent entry into the
 *   shape SlotDeliveryService consumes per delivery call.
 * - `toSnapshot`: project a runtime entry into the Redis-storable snapshot
 *   (drops live objects: message, channel, timer handle, personality
 *   instances). Used by persistence and recovery.
 */

import type { Message } from 'discord.js';
import {
  USER_ERROR_MESSAGES,
  type ApiErrorCategory,
  type ApiErrorType,
} from '@tzurot/common-types/constants/error';
import type { TypingChannel } from '@tzurot/common-types/types/discord-types';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { SlotDeliveryContext } from './SlotDeliveryService.js';
import type { CoordinatorEntrySnapshot } from './MultiTagPersistence.js';
import type { SlotSource } from './SlotResolver.js';

/** Per-slot runtime state. Re-declared here so the helpers can be standalone. */
export interface RuntimeSlot {
  slotIndex: number;
  personality: LoadedPersonality;
  personaId: string;
  source: SlotSource;
  isAutoResponse: boolean;
  jobId: string;
  status: 'pending' | 'completed' | 'errored' | 'timedout';
  result?: LLMGenerationResult;
}

/** Per-fan-out runtime state. Mirrors the coordinator's private type. */
export interface RuntimeEntry {
  groupId: string;
  sourceMessageId: string;
  message: Message;
  channel: TypingChannel;
  guildId: string | null;
  clientId: string | undefined;
  userId: string;
  userMessageTime: Date;
  userMessageContent: string;
  slots: RuntimeSlot[];
  createdAt: number;
  timeoutHandle: NodeJS.Timeout;
  /**
   * Did the resolver's cap drop at least one tagged personality? Set at
   * fan-out start from `StartFanOutInput.truncated`; consumed by
   * `deliverGroup` to append a post-burst notice. Persisted to the
   * snapshot so the notice survives restart/recovery.
   */
  truncated: boolean;
}

/**
 * Build the SlotDeliveryContext for one slot. Pure projection — every field
 * is either constant across the group (channel/guild/clientId/message) or
 * slot-specific (personality/persona/isAutoResponse).
 */
export function buildSlotContext(entry: RuntimeEntry, slot: RuntimeSlot): SlotDeliveryContext {
  return {
    message: entry.message,
    channel: entry.channel,
    guildId: entry.guildId,
    clientId: entry.clientId,
    personality: slot.personality,
    personaId: slot.personaId,
    userMessageContent: entry.userMessageContent,
    userMessageTime: entry.userMessageTime,
    isAutoResponse: slot.isAutoResponse,
    recipientUserId: entry.userId,
  };
}

/**
 * Build the synthetic `success: false` result that drives an in-character
 * error reply. Single-sourced so both the per-slot delivery path
 * (`multiTagDeliveryFlow.deliverSlot`, safety-timeout / empty-content) and the
 * submit-failure path (`MultiTagCoordinator.submitSlot`'s catch) render the
 * character's voice identically: `buildErrorContent` reads `personalityErrorMessage`
 * first, falling back to `errorInfo.userMessage` then the generic default.
 */
export function buildSyntheticErrorResult(
  personality: LoadedPersonality,
  opts: {
    requestId: string;
    category: ApiErrorCategory;
    type: ApiErrorType;
    technicalMessage: string;
  }
): LLMGenerationResult {
  const { requestId, category, type, technicalMessage } = opts;
  return {
    requestId,
    success: false,
    error: technicalMessage,
    personalityErrorMessage: personality.errorMessage,
    errorInfo: {
      type,
      category,
      userMessage: USER_ERROR_MESSAGES[category],
      technicalMessage,
      referenceId: requestId,
      // No auto-retry fires on these synthesized paths; the user decides
      // whether to re-prompt after seeing the in-character error line.
      shouldRetry: false,
    },
  };
}

/** Project the runtime entry into the Redis-storable snapshot. */
export function toSnapshot(entry: RuntimeEntry): CoordinatorEntrySnapshot {
  return {
    groupId: entry.groupId,
    sourceMessageId: entry.sourceMessageId,
    channelId: entry.channel.id,
    guildId: entry.guildId,
    userId: entry.userId,
    userMessageTime: entry.userMessageTime.toISOString(),
    userMessageContent: entry.userMessageContent,
    slots: entry.slots.map(s => ({
      slotIndex: s.slotIndex,
      personalityId: s.personality.id,
      personalitySlug: s.personality.slug,
      // Persist the hot-path-resolved persona so recovery replays the
      // historically-correct attribution instead of re-resolving (which would
      // need Prisma + could attribute to a since-changed current persona).
      personaId: s.personaId,
      source: s.source,
      isAutoResponse: s.isAutoResponse,
      jobId: s.jobId,
      status: s.status,
    })),
    createdAt: entry.createdAt,
    truncated: entry.truncated,
  };
}

/**
 * The outcome of one slot submission — a discriminated union carrying the
 * personality (and, for `errored`, the classified error) so downstream
 * handling can respond per-character instead of collapsing every failure to
 * an anonymous string.
 *
 * - `'submitted'` — a live job to coordinate.
 * - `'denied'` — a genuine refusal: the character can't respond (denylisted,
 *   NSFW-gated, or restricted here). The input was understood; the character
 *   simply isn't available. Rendered as a single system notice when the whole
 *   batch is denied.
 * - `'errored'` — an infrastructure failure: the submission threw (e.g. a
 *   gateway write-timeout while persisting the trigger message). Transient.
 *   Carries a synthetic `success:false` result so the character can deliver
 *   the error IN ITS OWN VOICE (its `errorMessage`, else a canned line).
 *
 * NOTE: the `'errored'`/`'submitted'` discriminants here are DISJOINT from
 * `RuntimeSlot.status`'s `'errored'`/`'completed'` — those are post-submission
 * job-lifecycle states (a submitted slot whose result came back failed). These
 * describe whether the submission itself succeeded; they only share spelling.
 */
export type SlotOutcome =
  | {
      kind: 'submitted';
      jobId: string;
      personality: LoadedPersonality;
      personaId: string;
      source: SlotSource;
      isAutoResponse: boolean;
    }
  | { kind: 'denied'; personality: LoadedPersonality }
  | {
      kind: 'errored';
      personality: LoadedPersonality;
      isAutoResponse: boolean;
      spec: LLMGenerationResult;
    };

/**
 * Partition slot submissions into the dense runtime slots (submitted, status
 * `'pending'`) and the errored outcomes still owed an in-character error line.
 *
 * Dense slot indices: denied slots are skipped, surviving slots get 0..k-1.
 * The ResolvedSlot input may have had non-contiguous "logical" positions
 * (e.g., reply at 0, denied activation at 1, mention at 2 → dense becomes
 * [0:reply, 1:mention]). Recovery uses the snapshot's dense `slotIndex`
 * directly when rehydrating and never re-resolves from input — so the indices
 * are stable across the entry's lifetime and the dense numbering is the
 * canonical view.
 *
 * Denied outcomes need no accumulation — they render as a single system
 * notice only when the WHOLE batch is denied.
 */
export function partitionSlotSubmissions(slotSubmissions: SlotOutcome[]): {
  runtimeSlots: RuntimeSlot[];
  erroredOutcomes: Extract<SlotOutcome, { kind: 'errored' }>[];
} {
  const runtimeSlots: RuntimeSlot[] = [];
  const erroredOutcomes: Extract<SlotOutcome, { kind: 'errored' }>[] = [];
  let nextIndex = 0;
  for (const submission of slotSubmissions) {
    if (submission.kind !== 'submitted') {
      if (submission.kind === 'errored') {
        erroredOutcomes.push(submission);
      }
      continue;
    }
    runtimeSlots.push({
      slotIndex: nextIndex++,
      personality: submission.personality,
      personaId: submission.personaId,
      source: submission.source,
      isAutoResponse: submission.isAutoResponse,
      jobId: submission.jobId,
      status: 'pending',
    });
  }
  return { runtimeSlots, erroredOutcomes };
}
