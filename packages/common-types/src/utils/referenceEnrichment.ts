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
import { CONTENT_TYPES } from '../constants/media.js';
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
 * Whether a reference was posted by a bot account or webhook (as opposed to a
 * human Discord user) — true for `authorIsBot` or any non-empty `webhookId`.
 * This is the broad "machine-authored" signal; it does NOT identify *which* bot,
 * so it intentionally matches PluralKit / other webhooks too. Callers that need
 * "is this OUR persona's own line" (e.g. the `role="assistant"` quote signal)
 * must additionally name-match the active persona — this predicate alone is only
 * safe where any bot/webhook is the right scope (stripping the bot's own TTS
 * audio, building marker-only dedup stubs).
 */
export function isBotAuthoredReference(reference: {
  authorIsBot?: boolean;
  webhookId?: string | null;
}): boolean {
  // Structural param (not ReferencedMessage) so raw Discord.js Message shapes
  // adapt inline ({ authorIsBot: msg.author.bot, webhookId: msg.webhookId })
  // without a full-type cast; discord.js types webhookId as string | null,
  // unlike ReferencedMessage's optional string — hence the explicit null arm
  // (both falsy shapes mean the same thing: not webhook-delivered).
  return (
    reference.authorIsBot === true ||
    (reference.webhookId !== undefined &&
      reference.webhookId !== null &&
      reference.webhookId.length > 0)
  );
}

/**
 * Drop a bot/webhook-authored reference's own audio attachments.
 *
 * A personality reply is delivered via webhook with its TTS rendered as an
 * `audio/*` file attachment. That audio is system-generated *delivery* of the
 * bot's own text — not content the model "attached" — so surfacing it (folded as
 * an `[audio/…]` marker into a dedup stub, or as an attachment line in a full
 * quote) makes the model reason about "an audio message I sent". User voice
 * messages (user-authored, transcribed) are genuine content and are untouched.
 *
 * Identity is by authorship (`authorIsBot`/`webhookId`), not filename; only
 * `audio/*` is dropped, so a bot-posted image (real content) still survives.
 */
export function stripBotVoiceAttachments(reference: ReferencedMessage): ReferencedMessage {
  if (!isBotAuthoredReference(reference) || reference.attachments === undefined) {
    return reference;
  }
  const kept = reference.attachments.filter(
    att => !att.contentType.startsWith(CONTENT_TYPES.AUDIO_PREFIX)
  );
  return kept.length === reference.attachments.length
    ? reference
    : { ...reference, attachments: kept };
}

/**
 * The SINGLE truncation point for dedup-stub previews. Caps a TEXT preview to
 * `DEDUP_STUB_CONTENT` (+ `…`). Applied to text ONLY — never to text-with-markers — so
 * attachment markers (folded in separately, after this) can't eat the budget and squeeze
 * the text to a misleading fragment. `formatDedupedQuote` renders the result as-is: every
 * caller must cap here first (both `buildDedupedReferenceStub` and the stored-history path
 * in `xmlMetadataFormatters.formatQuotedSection`).
 */
export function capDedupText(text: string): string {
  const limit = TEXT_LIMITS.DEDUP_STUB_CONTENT;
  return text.length > limit ? text.substring(0, limit) + '...' : text;
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
 * With attachments present the returned `content` can exceed `DEDUP_STUB_CONTENT`
 * (markers are prepended AFTER the text is truncated) — that's intentional and FINAL:
 * `formatDedupedQuote` renders it as-is. It must NOT re-apply the limit to the combined
 * markers+text, or long image-filename markers eat the whole budget and squeeze the text
 * hint to a misleading fragment (`I...` for `I got myself off…`). The text is capped here
 * (this is the single truncation point); the markers are short metadata kept whole.
 */
export function buildDedupedReferenceStub(reference: ReferencedMessage): ReferencedMessage {
  // Bot-authored stubs carry NO preview. A snippet of the model's own prior text
  // is exactly the "continue this fragment" trigger; the full message is in
  // <chat_log> regardless, so the marker (added downstream) is enough. User
  // reply-targets keep a short preview — genuine content the model may need.
  let content = '';
  if (!isBotAuthoredReference(reference)) {
    const truncatedContent = capDedupText(reference.content);
    // Markers go FIRST (before the truncated text). The text already has its FULL
    // DEDUP_STUB_CONTENT budget above; markers are appended without eating it, because
    // formatDedupedQuote renders this as-is (no second truncation). The full message the
    // stub points at is in history regardless; the marker filenames are the correlation
    // hint that must survive.
    const attachmentMarkers = (reference.attachments ?? [])
      .map(att => `[${att.contentType}: ${att.name ?? 'attachment'}]`)
      .join('\n');
    content = [attachmentMarkers, truncatedContent].filter(s => s.length > 0).join('\n\n');
  }
  return {
    referenceNumber: reference.referenceNumber,
    discordMessageId: reference.discordMessageId,
    discordUserId: reference.discordUserId,
    authorUsername: reference.authorUsername,
    authorDisplayName: reference.authorDisplayName,
    // authorIsBot/webhookId still gate the content-emptying above; authorRole is the
    // carried-through classification the formatter renders as the <quote role> signal.
    authorIsBot: reference.authorIsBot,
    webhookId: reference.webhookId,
    authorRole: reference.authorRole,
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
