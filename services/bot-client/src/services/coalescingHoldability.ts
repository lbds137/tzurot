/**
 * Holdability predicates and skipped-list helpers for the coalescing hold:
 * what makes an activation trigger eligible to be held (plain text or voice)
 * vs. submitted immediately (image, file/document, or non-voice audio), plus
 * the capped skipped-list push and merge-on-survivor-failure helpers.
 * Extracted from CoalescingHoldRegistry so both files stay under `max-lines`.
 */

import type { Message } from 'discord.js';
import { AttachmentType, CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { COALESCING } from '@tzurot/common-types/constants/message';
import type { SkippedMessage } from '@tzurot/common-types/types/schemas/personality';
import { classifyForPreprocessing } from '@tzurot/common-types/utils/attachmentPreprocessingPlan';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  extractForwardedAttachments,
  hasForwardedSnapshots,
} from '../utils/forwardedMessageUtils.js';
import { hasVoiceMessageFlag, isVoiceAttachment } from '../utils/voiceAttachment.js';
import type { StartFanOutInput } from './multiTagCoordinatorHelpers.js';
import type { ResolvedSlot } from './SlotResolver.js';
import type { SubmitChatJobInput } from './character/PersonalityChatManager.js';
import type { NsfwGate } from './character/sharedNsfwGate.js';

const logger = createLogger('coalescingHoldability');

/** Submit context captured for a held trigger awaiting release or skipped promotion. */
export interface HeldTriggerContext {
  input: StartFanOutInput;
  resolved: ResolvedSlot;
}

/** Reason a coalescing hold cycle transitioned or tore down. */
export type CoalescingReleaseReason = 'completion' | 'deadline' | 'submit-denied' | 'submit-error';

/** Carried skipped-trigger payload from a failed survivor submission. */
export interface LostSkippedPayload {
  skippedCount: number;
  skippedContexts: HeldTriggerContext[];
}

/**
 * Maximum time (ms) a releasing cycle waits for already-arrived hold-time
 * `saveUserMessage` calls to settle before force-finalizing. Sized well above
 * the ~2.5s embed-processing delay and 5s gateway RPC timeout so normal saves
 * always finish, while a wedged fetch or continuous denied traffic cannot
 * stall a channel indefinitely.
 */
export const DEFAULT_SAVE_DRAIN_TIMEOUT_MS = 15_000;

/** In-memory coalescing hold state for one (channelId, personalityId) pair. */
export interface CoalescingHoldEntry {
  channelId: string;
  personalityId: string;
  awaitedJobId: string | null;
  newest: HeldTriggerContext | null;
  skipped: SkippedMessage[];
  /**
   * Full in-memory context ({input, resolved}) per skipped trigger, aligned
   * with `skipped` and capped identically. Never serialized to the wire (the
   * wire payload stays id-only `skipped`): it lets a failed survivor
   * submission promote the newest skipped trigger instead of dropping the
   * held rows.
   */
  skippedContexts: HeldTriggerContext[];
  createdAt: number;
  deadlineTimer: NodeJS.Timeout;
  /** Bounded cutoff timer armed while `drainingRelease` is true. */
  drainTimer?: NodeJS.Timeout;
  cycleId: number;
  /**
   * In-flight hold-time `saveUserMessage` operations that arrived while this
   * cycle was active. `releaseCycle` waits for these to settle before choosing
   * the survivor so a fast completion during the ~2.5s embed-processing save
   * window cannot tear down the entry and split a burst into separate replies.
   */
  pendingSaves: Set<Promise<void>>;
  /** True once a release for this cycle has entered the pending-save drain. */
  drainingRelease: boolean;
  /** Release reason captured when draining began (upgraded on submit failure). */
  pendingReleaseReason?: CoalescingReleaseReason;
  /** Carried survivor-failure skipped contexts accumulated while draining. */
  pendingReleaseLost?: LostSkippedPayload;
  /**
   * Discord createdTimestamp of the released survivor this in-flight cycle was
   * created for, stamped at release so a trigger whose save resolves after the
   * release can be recognized as older than the answer already owed: one
   * strictly older goes straight to skipped instead of becoming this cycle's
   * newest and answering before the survivor. Undefined on a cycle started
   * from an idle pair (no survivor yet).
   */
  survivorCreatedTimestamp?: number;
}

/**
 * Outcome of deciding how a finished hold cycle should transition:
 * - `'release'` — hand off `survivor` (either `entry.newest` or a promoted
 *   skipped trigger after survivor-submit failure) into a fresh cycle.
 * - `'idle'` — tear down the entry (nothing held and nothing promotable).
 */
export type ReleaseCyclePlan =
  | {
      kind: 'release';
      promoted: boolean;
      survivor: HeldTriggerContext;
      skipped: SkippedMessage[];
      skippedContexts: HeldTriggerContext[];
      previousJobId: string | null;
    }
  | {
      kind: 'idle';
      lostCount: number;
    };

/** Handoff written for a released survivor and consumed by its own fan-out. */
export interface PendingSurvivorRelease {
  cycleId: number;
  /** The survivor this handoff belongs to — step 1 consumes only for it. */
  survivorMessageId: string;
  skippedMessages: SkippedMessage[];
  /** Full in-memory contexts backing `skippedMessages`, for survivor promotion. */
  skippedContexts: HeldTriggerContext[];
}

/** Input payload for transitioning a pair into a released survivor cycle. */
export interface BeginSurvivorCycleOpts {
  channelId: string;
  personalityId: string;
  survivor: HeldTriggerContext;
  skipped: SkippedMessage[];
  skippedContexts: HeldTriggerContext[];
  previousJobId: string | null;
  reason: CoalescingReleaseReason;
  holdStartedAt: number;
}

/** Raw attachment shape seen on Discord.js Message.attachments or test mocks. */
interface InspectableAttachment {
  url?: string;
  contentType?: string | null;
  duration?: number | null;
  isVoiceMessage?: boolean;
}

/**
 * Classify a single attachment FOR THE HOLDABILITY PREDICATE into
 * AttachmentType (Image, Audio, File). Only VOICE audio stays Audio — its
 * transcript already sits in the row text, so skipping it loses nothing. A
 * plain audio upload (audio/mpeg, no voice flag) counts like a file here
 * because its content would be lost on skip; the generation pipeline's own
 * classification (classifyForPreprocessing) still treats it as Audio.
 * Voice messages include Vencord video/webm carrying the parent message's
 * IsVoiceMessage flag; everything else delegates to the shared preprocessing
 * classifier over url + contentType.
 */
function classifyTriggerAttachment(
  attachment: InspectableAttachment,
  messageIsVoice: boolean
): AttachmentType {
  const isVoice =
    attachment.isVoiceMessage === true || isVoiceAttachment(attachment, { messageIsVoice });

  const kind = classifyForPreprocessing({
    url: attachment.url ?? '',
    contentType: attachment.contentType ?? CONTENT_TYPES.BINARY,
    isVoiceMessage: isVoice,
  });

  if (kind === 'image') {
    return AttachmentType.Image;
  }
  if (kind === 'audio') {
    return isVoice ? AttachmentType.Audio : AttachmentType.File;
  }
  return AttachmentType.File;
}

/**
 * Collect direct attachments from a Discord Message (or test stub where
 * `attachments` may be undefined, a Collection/Map, or an Array).
 */
function collectDirectAttachments(message: Message): InspectableAttachment[] {
  const raw = (message as { attachments?: unknown }).attachments;
  if (raw === undefined || raw === null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw as InspectableAttachment[];
  }
  if (typeof (raw as { values?: unknown }).values === 'function') {
    return Array.from((raw as { values(): Iterable<InspectableAttachment> }).values());
  }
  return [];
}

/**
 * Whether a trigger message carries any image or file/document attachment.
 * Voice attachments (`AttachmentType.Audio`) return false because their transcript
 * already sits in the row text and they are eligible to coalesce.
 */
export function hasImageOrFileAttachment(message: Message): boolean {
  const messageIsVoice = hasVoiceMessageFlag(message);

  for (const attachment of collectDirectAttachments(message)) {
    const kind = classifyTriggerAttachment(attachment, messageIsVoice);
    if (kind === AttachmentType.Image || kind === AttachmentType.File) {
      return true;
    }
  }

  if (hasForwardedSnapshots(message)) {
    for (const attachment of extractForwardedAttachments(message)) {
      const kind = classifyTriggerAttachment(attachment, messageIsVoice);
      if (kind === AttachmentType.Image || kind === AttachmentType.File) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Hold predicate: a slot is holdable iff its source is `'activation'` AND the
 * trigger carries no image and no file/document attachment. Mention, reply, and
 * dm-session slots are excluded by the source check alone.
 */
export function isHoldableActivationSlot(message: Message, resolved: ResolvedSlot): boolean {
  if (resolved.source !== 'activation') {
    return false;
  }
  return !hasImageOrFileAttachment(message);
}

/**
 * Push one trigger onto an entry's skipped lists (wire ids + full context),
 * trimming both at `COALESCING.MAX_SKIPPED_MESSAGES` (dropping oldest first).
 */
export function pushToSkippedLists(
  entry: {
    channelId: string;
    personalityId: string;
    skipped: SkippedMessage[];
    skippedContexts: HeldTriggerContext[];
  },
  context: HeldTriggerContext
): void {
  entry.skipped.push({
    messageId: context.input.message.id,
    authorId: context.input.message.author.id,
  });
  entry.skippedContexts.push(context);
  if (entry.skipped.length > COALESCING.MAX_SKIPPED_MESSAGES) {
    const droppedCount = entry.skipped.length - COALESCING.MAX_SKIPPED_MESSAGES;
    entry.skipped.splice(0, droppedCount);
    entry.skippedContexts.splice(0, droppedCount);
    logger.info(
      { channelId: entry.channelId, personalityId: entry.personalityId, droppedCount },
      'Dropped oldest skipped coalesced triggers at the cap'
    );
  }
}

/**
 * Merge a failed survivor's carried `lostContexts` into the current entry's
 * skipped lists when a newer trigger is already waiting as `entry.newest`.
 * Keeps wire ids (`skipped`) and full contexts (`skippedContexts`) index-aligned
 * and trims both at `COALESCING.MAX_SKIPPED_MESSAGES`, dropping the oldest by
 * `createdTimestamp`.
 */
export function mergeSkippedForSurvivor(
  entry: {
    channelId: string;
    personalityId: string;
    skipped: SkippedMessage[];
    skippedContexts: HeldTriggerContext[];
  },
  lostContexts: HeldTriggerContext[]
): { skipped: SkippedMessage[]; skippedContexts: HeldTriggerContext[] } {
  if (lostContexts.length === 0) {
    return { skipped: [...entry.skipped], skippedContexts: [...entry.skippedContexts] };
  }
  const skippedContexts = [...lostContexts, ...entry.skippedContexts].sort(
    (a, b) => a.input.message.createdTimestamp - b.input.message.createdTimestamp
  );
  if (skippedContexts.length > COALESCING.MAX_SKIPPED_MESSAGES) {
    const droppedCount = skippedContexts.length - COALESCING.MAX_SKIPPED_MESSAGES;
    skippedContexts.splice(0, droppedCount);
    logger.info(
      { channelId: entry.channelId, personalityId: entry.personalityId, droppedCount },
      'Dropped oldest skipped coalesced triggers at the cap'
    );
  }
  const skipped = skippedContexts.map(c => ({
    messageId: c.input.message.id,
    authorId: c.input.message.author.id,
  }));
  return { skipped, skippedContexts };
}

/**
 * Place a saved holdable trigger into an active entry using Discord
 * `createdTimestamp` latest-wins order:
 * - Newer than `entry.newest` displaces the incumbent into `skipped`.
 * - Older than (or tied with) `entry.newest`, or strictly older than the
 *   cycle's released survivor (`survivorCreatedTimestamp`), goes straight to
 *   `skipped`.
 * - Otherwise becomes `entry.newest`.
 */
export function recordHeldTriggerInEntry(
  entry: {
    channelId: string;
    personalityId: string;
    newest: HeldTriggerContext | null;
    skipped: SkippedMessage[];
    skippedContexts: HeldTriggerContext[];
    survivorCreatedTimestamp?: number;
  },
  context: HeldTriggerContext
): void {
  if (entry.newest !== null) {
    // Latest-wins by Discord timestamps, not by resolve order: whoever's
    // saveUserMessage resolves last is not necessarily the newest message.
    // On an exact tie the incumbent stays newest; an arriving older message
    // takes the incumbent's place on the skipped list instead.
    const arrivingNewer =
      context.input.message.createdTimestamp > entry.newest.input.message.createdTimestamp;
    const displaced = arrivingNewer ? entry.newest : context;
    pushToSkippedLists(entry, displaced);
    if (arrivingNewer) {
      entry.newest = context;
    }
    return;
  }

  if (
    entry.survivorCreatedTimestamp !== undefined &&
    context.input.message.createdTimestamp < entry.survivorCreatedTimestamp
  ) {
    // Strictly older than the survivor whose release created this cycle:
    // it would answer BEFORE the survivor if it became this cycle's newest,
    // so straight to skipped. Exact ties become newest — save-resolution
    // order already orders them.
    pushToSkippedLists(entry, context);
    return;
  }

  entry.newest = context;
}

/**
 * Merge a second release's `lost` payload into one already buffered on a
 * draining entry (e.g. deadline started the drain, then the survivor's own
 * submission failed carrying skipped contexts that must still be promoted).
 */
export function mergeLostPayloads(
  existing: LostSkippedPayload | undefined,
  incoming: LostSkippedPayload | undefined
): LostSkippedPayload | undefined {
  if (incoming === undefined) {
    return existing;
  }
  if (existing === undefined) {
    return {
      skippedCount: incoming.skippedCount,
      skippedContexts: [...incoming.skippedContexts],
    };
  }
  return {
    skippedCount: existing.skippedCount + incoming.skippedCount,
    skippedContexts: [...existing.skippedContexts, ...incoming.skippedContexts],
  };
}

/**
 * Decide the post-drain transition for a cycle: release `entry.newest` (merging
 * any carried `lostContexts`), promote the newest promotable skipped trigger
 * when a survivor submission failed with `entry.newest === null`, or idle out.
 */
export function buildReleaseCyclePlan(
  entry: CoalescingHoldEntry,
  lost?: LostSkippedPayload
): ReleaseCyclePlan {
  if (entry.newest === null) {
    const lostContexts = lost?.skippedContexts ?? [];
    const promotable =
      lost !== undefined ? [...lostContexts, ...entry.skippedContexts] : lostContexts;
    if (promotable.length > 0) {
      const sorted = [...promotable].sort(
        (a, b) => b.input.message.createdTimestamp - a.input.message.createdTimestamp
      );
      const promoted = sorted[0];
      const remaining = sorted.slice(1);
      return {
        kind: 'release',
        promoted: true,
        survivor: promoted,
        skipped: remaining.map(c => ({
          messageId: c.input.message.id,
          authorId: c.input.message.author.id,
        })),
        skippedContexts: remaining,
        previousJobId: null,
      };
    }
    return { kind: 'idle', lostCount: lost?.skippedCount ?? 0 };
  }

  const { skipped, skippedContexts } = mergeSkippedForSurvivor(entry, lost?.skippedContexts ?? []);
  return {
    kind: 'release',
    promoted: false,
    survivor: entry.newest,
    skipped,
    skippedContexts,
    previousJobId: entry.awaitedJobId,
  };
}

/** Clear both the hold deadline timer and any active save-drain cutoff timer. */
export function clearEntryTimers(
  entry: Pick<CoalescingHoldEntry, 'deadlineTimer' | 'drainTimer'>
): void {
  clearTimeout(entry.deadlineTimer);
  if (entry.drainTimer !== undefined) {
    clearTimeout(entry.drainTimer);
    entry.drainTimer = undefined;
  }
}

/** Construct a fresh in-flight hold entry for `(channelId, personalityId)`. */
export function createCoalescingHoldEntry(opts: {
  channelId: string;
  personalityId: string;
  cycleId: number;
  deadlineTimer: NodeJS.Timeout;
  carriedPendingSaves?: ReadonlySet<Promise<void>>;
}): CoalescingHoldEntry {
  return {
    channelId: opts.channelId,
    personalityId: opts.personalityId,
    awaitedJobId: null,
    newest: null,
    skipped: [],
    skippedContexts: [],
    createdAt: Date.now(),
    deadlineTimer: opts.deadlineTimer,
    cycleId: opts.cycleId,
    pendingSaves: new Set(opts.carriedPendingSaves),
    drainingRelease: false,
  };
}

/** Build the `PersonalityChatManager.submitChatJob` payload for a slot. */
export function buildSubmitChatJobInput(
  input: StartFanOutInput,
  resolved: ResolvedSlot,
  nsfwGate: NsfwGate,
  extra?: { skipUserMessageSave?: boolean; skippedMessages?: SkippedMessage[] }
): SubmitChatJobInput {
  const nonEmptySkipped =
    extra?.skippedMessages !== undefined && extra.skippedMessages.length > 0
      ? extra.skippedMessages
      : undefined;
  return {
    message: input.message,
    personality: resolved.personality,
    content: input.content,
    isAutoResponse: resolved.isAutoResponse,
    nsfwGate,
    ...(extra?.skipUserMessageSave === true ? { skipUserMessageSave: true } : {}),
    ...(nonEmptySkipped !== undefined ? { skippedMessages: nonEmptySkipped } : {}),
  };
}

/**
 * Arm a single bounded drain cutoff and wait for `entry.pendingSaves` to settle
 * before invoking `onFinalize`. If every snapshot save was denied/errored while
 * newer saves arrived during the drain, re-drains under the SAME `drainTimer`
 * cutoff so continuous denied traffic cannot extend the cycle indefinitely.
 */
export function startBoundedPendingSaveDrain(opts: {
  entry: CoalescingHoldEntry;
  saveDrainTimeoutMs: number;
  getCurrent: () => CoalescingHoldEntry | undefined;
  onFinalize: (current: CoalescingHoldEntry) => void;
  onError: (err: unknown, entry: CoalescingHoldEntry) => void;
}): void {
  const { entry, saveDrainTimeoutMs, getCurrent, onFinalize, onError } = opts;

  const finalizeIfCurrent = (): void => {
    const current = getCurrent();
    if (current?.cycleId !== entry.cycleId) {
      return;
    }
    if (current.drainTimer !== undefined) {
      clearTimeout(current.drainTimer);
      current.drainTimer = undefined;
    }
    onFinalize(current);
  };

  entry.drainTimer = setTimeout(() => {
    entry.drainTimer = undefined;
    finalizeIfCurrent();
  }, saveDrainTimeoutMs);

  const waitSnapshot = (target: CoalescingHoldEntry): void => {
    const snapshot = Array.from(target.pendingSaves);
    void Promise.all(snapshot)
      .then(() => {
        const current = getCurrent();
        if (current?.cycleId !== entry.cycleId) {
          return;
        }
        if (
          current.newest === null &&
          (current.pendingReleaseLost?.skippedContexts.length ?? 0) === 0 &&
          current.pendingSaves.size > 0
        ) {
          waitSnapshot(current);
          return;
        }
        finalizeIfCurrent();
      })
      .catch((err: unknown) => {
        onError(err, entry);
      });
  };

  waitSnapshot(entry);
}
