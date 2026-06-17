/**
 * Reference enrichment kernels — the pure decision/transform logic shared by
 * bot-client's reference pipeline (crawler + formatter) and ai-worker's
 * context assembler.
 *
 * Shared-implementation guarantee: both sides call these exact functions, so
 * the dedup decision, the stub shape, and the transcript-append format cannot
 * drift between the legacy bot-side path and the worker-side re-derivation.
 *
 * What stays caller-side: HOW the inputs are obtained. Bot-client derives
 * candidates from live Discord `Message` objects and retrieves transcripts
 * through its Redis-cache + DB tiers; ai-worker derives candidates from raw
 * envelope reference snapshots and retrieves transcripts DB-only.
 */

import { TEXT_LIMITS } from '../constants/discord.js';
import { INTERVALS } from '../constants/timing.js';
import type { AttachmentMetadata } from '../types/schemas/discord.js';
import type { ReferencedMessage } from '../types/schemas/message.js';

/** The fields the dedup decision reads — derivable from either a live Discord message or a raw reference snapshot. */
export interface ReferenceDedupCandidate {
  /** Discord message id of the referenced message. */
  discordMessageId: string;
  /** Message creation time (epoch ms). */
  timestampMs: number;
  /**
   * Whether the referenced message was authored by a webhook or a bot — the
   * only authors eligible for the time-based fallback (personality replies
   * arrive via webhook and may be persisted under a different Discord id).
   */
  isWebhookOrBotAuthored: boolean;
}

/** Conversation-history view the dedup decision compares against. */
export interface ReferenceDedupHistory {
  /** Every Discord message id present in the conversation history. */
  messageIds: ReadonlySet<string>;
  /** Creation timestamps of the history rows (for the time-based fallback). */
  timestamps: readonly Date[];
}

/**
 * Decide whether a referenced message duplicates conversation history.
 *
 * Exact match: the candidate's Discord id appears in history. Time-based
 * fallback: webhook/bot-authored candidates created within the dedup window
 * of `nowMs` whose timestamp matches a history row within tolerance (covers
 * personality replies whose webhook message id differs from the persisted
 * row's id).
 *
 * `nowMs` anchors the recency window: bot-client passes wall-clock at crawl
 * time, ai-worker passes the job's enqueue timestamp (the closest available
 * stand-in — re-running with the worker's wall clock would shrink the window
 * by the queue latency). When undefined, the time-based fallback is skipped
 * entirely and only exact-id matching applies.
 */
export function isDuplicateReference(
  candidate: ReferenceDedupCandidate,
  history: ReferenceDedupHistory,
  nowMs: number | undefined
): boolean {
  if (history.messageIds.has(candidate.discordMessageId)) {
    return true;
  }

  if (!candidate.isWebhookOrBotAuthored || nowMs === undefined) {
    return false;
  }

  const ageMs = nowMs - candidate.timestampMs;
  if (ageMs >= INTERVALS.MESSAGE_AGE_DEDUP_WINDOW) {
    return false;
  }

  for (const historyTimestamp of history.timestamps) {
    const timeDiff = Math.abs(candidate.timestampMs - historyTimestamp.getTime());
    if (timeDiff < INTERVALS.MESSAGE_TIMESTAMP_TOLERANCE) {
      return true;
    }
  }

  return false;
}

/**
 * Collapse a full reference into the minimal deduplicated stub: truncated
 * content (with attachment markers), no embeds/location. The stub keeps the
 * reference number — numbering is assigned before the dedup decision, so stubs
 * consume numbers and downstream `[Reference N]` links stay stable.
 *
 * Attachment markers (`[contentType: name]`) are folded into the content so an
 * image-only reply-target doesn't collapse to an empty quote — without them the
 * model sees nothing and reports "no image," even though the full message (with
 * its rendered image description) is in the history the stub points at. The
 * marker's filename lets the model correlate the stub with that history entry.
 *
 * Contract: with attachments present the returned `content` can exceed
 * `DEDUP_STUB_CONTENT` (markers are prepended AFTER the text is truncated), so a
 * caller that treats it as final output must re-apply the limit. The prompt path
 * already does, via `formatDedupedQuote`.
 */
export function buildDedupedReferenceStub(reference: ReferencedMessage): ReferencedMessage {
  const limit = TEXT_LIMITS.DEDUP_STUB_CONTENT;
  const truncatedContent =
    reference.content.length > limit
      ? reference.content.substring(0, limit) + '...'
      : reference.content;
  // Markers go FIRST so they survive downstream re-truncation: formatDedupedQuote
  // applies DEDUP_STUB_CONTENT to the COMBINED (markers + text) string and trims
  // from the end, so the effective text budget there is DEDUP_STUB_CONTENT minus
  // the marker length. Squeezing the text hint is acceptable — the full message
  // (the thing the stub points at) is in history regardless; the marker is not.
  const attachmentMarkers = (reference.attachments ?? [])
    .map(att => `[${att.contentType}: ${att.name ?? 'attachment'}]`)
    .join('\n');
  const content = [attachmentMarkers, truncatedContent].filter(s => s.length > 0).join('\n\n');
  return {
    referenceNumber: reference.referenceNumber,
    discordMessageId: reference.discordMessageId,
    discordUserId: reference.discordUserId,
    authorUsername: reference.authorUsername,
    authorDisplayName: reference.authorDisplayName,
    content,
    embeds: '',
    timestamp: reference.timestamp,
    locationContext: '',
    isDeduplicated: true,
  };
}

/** Retrieves the transcript for one voice attachment, or null when unavailable. */
export type TranscriptRetrieveFn = (
  discordMessageId: string,
  attachmentUrl: string
) => Promise<string | null>;

/**
 * Append voice transcripts to reference content. For each voice attachment,
 * the retriever is consulted; found transcripts are joined and appended as a
 * single `[Voice transcript]:` block. Content is returned unchanged when the
 * message has no voice attachments or no transcripts are found.
 */
export async function appendVoiceTranscripts(opts: {
  content: string;
  attachments: readonly AttachmentMetadata[];
  discordMessageId: string;
  retrieve: TranscriptRetrieveFn;
}): Promise<string> {
  const { content, attachments, discordMessageId, retrieve } = opts;
  if (attachments.length === 0) {
    return content;
  }

  const voiceAttachments = attachments.filter(a => a.isVoiceMessage === true);
  if (voiceAttachments.length === 0) {
    return content;
  }

  // Parallel fetches; Promise.all preserves attachment order, so the joined
  // transcript block reads in the same order the attachments appear.
  const retrieved = await Promise.all(voiceAttachments.map(a => retrieve(discordMessageId, a.url)));
  const transcripts = retrieved.filter((t): t is string => t !== null && t.length > 0);

  if (transcripts.length === 0) {
    return content;
  }

  const transcriptText = transcripts.join('\n\n');
  return content
    ? `${content}\n\n[Voice transcript]: ${transcriptText}`
    : `[Voice transcript]: ${transcriptText}`;
}
