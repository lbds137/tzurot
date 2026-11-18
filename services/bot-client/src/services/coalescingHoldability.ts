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

const logger = createLogger('coalescingHoldability');

/** Submit context captured for a held trigger awaiting release or skipped promotion. */
export interface HeldTriggerContext {
  input: StartFanOutInput;
  resolved: ResolvedSlot;
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
