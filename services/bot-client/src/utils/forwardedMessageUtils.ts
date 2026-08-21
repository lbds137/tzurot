/**
 * Forwarded Message Utilities
 *
 * Centralized utilities for handling Discord forwarded messages.
 * This is the SINGLE SOURCE OF TRUTH for forwarded message detection and content extraction.
 *
 * Discord Forwarded Message Structure:
 * - message.reference.type === MessageReferenceType.Forward
 * - message.messageSnapshots contains snapshot(s) of forwarded content
 * - message.content is typically empty (content is in snapshots)
 * - message.attachments may be empty (attachments are in snapshots)
 *
 * IMPORTANT: Discord may not always populate messageSnapshots due to:
 * - API limitations
 * - Permission restrictions
 * - Network/caching issues
 *
 * This module handles both cases gracefully.
 */

import {
  ChannelType,
  type Message,
  type MessageSnapshot,
  type Collection,
  MessageReferenceType,
  PermissionFlagsBits,
  type TextBasedChannel,
} from 'discord.js';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { extractAttachments } from './attachmentExtractor.js';
import { extractEmbedImages } from './embedImageExtractor.js';
import { extractSnapshotStickerImages } from './stickerAttachments.js';
import { satisfiesPrivateThreadMembership } from './threadAccess.js';
import { isVoiceAttachment } from './voiceAttachment.js';
import { resolveWebhookAwareDisplayName } from './webhookNaming.js';
import { type ForwardedOrigin } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { stripBotFooters } from '@tzurot/common-types/utils/discord';

const logger = createLogger('forwardedMessageUtils');

/**
 * Check if a message is a forwarded message.
 *
 * This is the canonical check - use this everywhere instead of inline checks.
 *
 * A forwarded message is identified by EITHER:
 * 1. message.reference.type === MessageReferenceType.Forward (primary check)
 * 2. message.messageSnapshots exists and has size > 0 (fallback check)
 *
 * The fallback is needed because Discord.js may not always populate reference.type
 * correctly, but messageSnapshots is a reliable indicator of forwarded content.
 *
 * @param message - Discord message to check
 * @returns true if the message is a forwarded message
 */
export function isForwardedMessage(message: Message | null | undefined): boolean {
  if (!message) {
    return false;
  }

  // Primary check: reference type is Forward
  if (message.reference?.type === MessageReferenceType.Forward) {
    return true;
  }

  // Fallback check: messageSnapshots exist (only forwarded messages have these)
  if (
    message.messageSnapshots !== null &&
    message.messageSnapshots !== undefined &&
    message.messageSnapshots.size > 0
  ) {
    return true;
  }

  return false;
}

/**
 * Check if a forwarded message has snapshot data available.
 *
 * Use this when you need to know if snapshot content is available,
 * such as when deciding how to extract content.
 *
 * @param message - Discord message to check
 * @returns true if the message has forwarded snapshots
 */
export function hasForwardedSnapshots(message: Message | null | undefined): boolean {
  if (!message) {
    return false;
  }
  return (
    isForwardedMessage(message) &&
    message.messageSnapshots !== undefined &&
    message.messageSnapshots !== null &&
    message.messageSnapshots.size > 0
  );
}

/**
 * Get the first snapshot from a forwarded message.
 *
 * Forwarded messages typically have one snapshot, but the API returns a Collection.
 * This utility safely extracts the first (and usually only) snapshot.
 *
 * @param message - Discord message (should be a forwarded message)
 * @returns The first snapshot, or undefined if none available
 */
export function getFirstSnapshot(message: Message): MessageSnapshot | undefined {
  if (!hasForwardedSnapshots(message)) {
    return undefined;
  }
  return message.messageSnapshots?.first();
}

/**
 * Get all snapshots from a forwarded message.
 *
 * @param message - Discord message (should be a forwarded message)
 * @returns Collection of snapshots, or undefined if none available
 */
export function getSnapshots(message: Message): Collection<string, MessageSnapshot> | undefined {
  if (!hasForwardedSnapshots(message)) {
    return undefined;
  }
  return message.messageSnapshots;
}

/**
 * Extract text content from a forwarded message.
 *
 * Tries to extract content from snapshots first, falls back to main message content.
 * Handles the case where Discord doesn't populate snapshots.
 *
 * **This is the single source of truth for a forward's text.** Any code that
 * needs the *text a user would read* from a (possibly-forwarded) message must
 * route through here (or accept already-extracted content as a parameter) —
 * never re-derive from `message.content` directly, which is EMPTY for forwards.
 * A direct read silently drops all forwarded text — the footgun behind both the
 * forwarded-trigger-empty-content bug and forwarded links not being crawled.
 * Safe for non-forwards: with no snapshot it returns `message.content` unchanged.
 *
 * Distinct, non-overlapping paths (do NOT merge them):
 * - **raw text for rewriting** (this fn → mention/link rewriting, crawling)
 * - **rendered content for display/history** (buildMessageContent → adds
 *   attachment descriptions; running rewriting over it would corrupt those)
 * - **persistence** (already-extracted `ConversationMessage.content`)
 *
 * Snapshot asymmetry caveat: forward snapshot content is present on the live
 * `MESSAGE_CREATE` gateway event but ABSENT on a REST re-fetch — any refetch
 * path that expects forward text will get empty. Capture it live, thread it.
 *
 * @param message - Discord message (should be a forwarded message)
 * @returns Extracted content string
 */
export function extractForwardedContent(message: Message): string {
  // Try snapshot content first
  const snapshot = getFirstSnapshot(message);
  if (snapshot?.content !== undefined && snapshot.content.length > 0) {
    return snapshot.content;
  }

  // Fallback to main message content
  // This handles edge cases where Discord doesn't populate snapshots
  return message.content;
}

/**
 * Extract a forward's text, stripped of our own `-#` footers, for content
 * headed into the LLM prompt.
 *
 * The plain {@link extractForwardedContent} stays byte-faithful because it
 * also feeds routing, mention detection, and link parsing — those consumers
 * need what the forwarder's snapshot actually contains, footer and all. This
 * accessor exists for the narrower prompt-bound path, where a forwarded
 * snapshot of one of OUR OWN character replies would otherwise carry our
 * `-# Model: …` / incognito / auto-response markup into the model's context.
 *
 * The strip is unconditional — no authorship or origin check — because it is
 * scoped to OUR markup: `stripBotFooters`'s patterns each require a
 * distinctive emoji plus an exact phrase, or `-# Model: ` / `-# Transcribed
 * by ` followed by a well-formed `[text](<url>)` link. It is our own text to
 * remove, not the forwarder's. The one place that reaches past our exact
 * output is the `MODEL` pattern's documented ACCEPTED WIDENING
 * (`BOT_FOOTER_PATTERNS` in common-types), whose stated cost — the author's
 * own quoted text missing from what is fed back to the model — is precisely
 * this path, and was judged acceptable there. That widening reaches one step
 * further here than at the other prompt-bound sites: when Discord omits
 * snapshots, {@link extractForwardedContent} falls back to the wrapper's
 * content, which is the FORWARDER's own typed text rather than ours. The same
 * accepted cost applies, and the shape it would take to trigger is the same
 * one judged vanishingly unlikely above.
 *
 * @param message - Discord message (should be a forwarded message)
 * @returns Forwarded content with bot footers removed
 */
export function extractForwardedContentForPrompt(message: Message): string {
  return stripBotFooters(extractForwardedContent(message));
}

/**
 * Extract attachments from a forwarded message's snapshots.
 *
 * Forwarded messages typically have their attachments in snapshots, not the main message.
 * This extracts attachments from all snapshots.
 *
 * @param message - Discord message (should be a forwarded message)
 * @returns Array of attachment metadata from snapshots
 */
export function extractForwardedAttachments(message: Message): AttachmentMetadata[] {
  const attachments: AttachmentMetadata[] = [];

  const snapshots = getSnapshots(message);
  if (snapshots === undefined) {
    return attachments;
  }

  for (const snapshot of snapshots.values()) {
    // Extract regular attachments from snapshot
    if (snapshot.attachments !== undefined && snapshot.attachments !== null) {
      const extracted = extractAttachments(snapshot.attachments);
      if (extracted !== undefined) {
        attachments.push(...extracted);
      }
    }

    // Extract images from snapshot embeds
    const embedImages = extractEmbedImages(snapshot.embeds);
    if (embedImages !== undefined) {
      attachments.push(...embedImages);
    }

    // ...and the snapshot's stickers, which were the one media kind this walk
    // skipped — a forwarded sticker arrived name-only, never described.
    const stickerImages = extractSnapshotStickerImages(snapshot);
    if (stickerImages !== undefined) {
      attachments.push(...stickerImages);
    }
  }

  return attachments;
}

/**
 * Check if a forwarded message contains voice message attachments.
 *
 * Reads the precomputed `AttachmentMetadata.isVoiceMessage` flag rather than
 * re-running {@link isVoiceAttachment} here: `extractAttachments` already
 * evaluated the predicate against the RAW attachment (before normalizing a
 * null content-type to `application/octet-stream`), so the flag preserves the
 * duration fallback for content-type-absent voice snapshots. Calling
 * `isVoiceAttachment` on the already-normalized metadata here would lose that
 * fallback and disagree with the flag on the very same object.
 *
 * The no-snapshots fallback is this function's own, NOT inherited from
 * {@link extractForwardedAttachments} — that one returns an empty array when
 * Discord hasn't populated snapshots. Reading the wrapping message's
 * attachments instead is what lets a snapshot-less forward of a voice note
 * still be recognized, and is pinned by this function's tests.
 *
 * @param message - Discord message (should be a forwarded message)
 * @returns true if the forwarded message contains voice attachments
 */
export function hasForwardedVoiceAttachment(message: Message): boolean {
  if (!isForwardedMessage(message)) {
    return false;
  }

  const attachments = hasForwardedSnapshots(message)
    ? extractForwardedAttachments(message)
    : [
        ...(extractAttachments(message.attachments) ?? []),
        ...(extractEmbedImages(message.embeds) ?? []),
      ];

  return attachments.some(a => a.isVoiceMessage === true);
}

/**
 * Check if a message contains voice attachments, either as direct attachments
 * or within forwarded message snapshots.
 */
export function hasVoiceAttachments(message: Message): boolean {
  const hasDirectVoice = message.attachments.some(isVoiceAttachment);
  return hasDirectVoice || hasForwardedVoiceAttachment(message);
}

/**
 * Get the effective text content from any message type.
 *
 * This is the canonical method for getting text content from a message.
 * Use this instead of directly accessing message.content to handle:
 * - Regular messages: returns message.content
 * - Forwarded messages: returns snapshot content (with fallback to main content)
 *
 * @param message - Discord message (any type)
 * @returns The effective text content
 */
export function getEffectiveContent(message: Message): string {
  // For forwarded messages, try to extract from snapshots first
  if (isForwardedMessage(message)) {
    return extractForwardedContent(message);
  }

  // Regular messages: return main content directly
  return message.content;
}

/**
 * Get the effective text content from any message type, for content headed
 * into the LLM prompt.
 *
 * Mirrors {@link getEffectiveContent}'s structure exactly, routing a forward
 * through {@link extractForwardedContentForPrompt} instead of the
 * byte-faithful accessor. The plain `getEffectiveContent` stays byte-faithful
 * because it also feeds routing, mention detection, and link parsing; this
 * variant exists only for the prompt-bound callers that need our own footer
 * markup stripped from a forwarded snapshot of one of our own replies.
 *
 * A non-forwarded message is returned byte-identical to `message.content` —
 * the strip applies only to the forward-snapshot path, never to a regular
 * trigger message.
 *
 * @param message - Discord message (any type)
 * @returns The effective text content, with bot footers stripped for forwards
 */
export function getEffectiveContentForPrompt(message: Message): string {
  if (isForwardedMessage(message)) {
    return extractForwardedContentForPrompt(message);
  }

  return message.content;
}

/**
 * Recover the identity of a forwarded message's original author and post time.
 *
 * Discord's `message_snapshots` omit `author` and `id` — verified against a
 * live forward, whose snapshot carried only attachments, components, content,
 * edited_timestamp, embeds, flags, mention_roles, mentions, timestamp and
 * type. That is why a forward previously rendered as `from="Unknown"` with no
 * `t=`: there was nothing in the snapshot to attribute it to.
 *
 * The forwarding message does carry `message_reference.message_id` and
 * `channel_id`, and fetching that message returns the full original. The two
 * halves therefore cost different things and are resolved independently:
 *
 * - the **timestamp** comes straight off the snapshot, no network call, so it
 *   survives even when the original is gone;
 * - the **author** needs the fetch, and is simply absent when that fails.
 *
 * FAILS OPEN at every step. A deleted original, an unreadable channel, or a
 * revoked permission yields a partial result or `undefined`, and the renderer
 * falls back to the same unattributed quote it produced before this existed —
 * a forward is context, and losing its attribution must never cost the message
 * itself.
 *
 * @param message - a message for which `isForwardedMessage` is true
 * @returns recovered origin fields, or undefined when nothing was recoverable
 */
/**
 * The origin author's display name for the quote attribution.
 *
 * A webhook author's displayName IS the webhook username, which for our own
 * characters carries the bot suffix ("Name · Bot") — strip it so the quote
 * binds to the character's rendered name, the way every other consumer of
 * webhook usernames does. A foreign webhook's name carries no such suffix and
 * passes through unchanged; a human's displayName is untouched.
 */
function resolveOriginAuthorName(original: Message, botTag: string | undefined): string {
  return resolveWebhookAwareDisplayName(original.author.displayName, original.webhookId, botTag);
}

/**
 * The origin channel's name, gated on the FORWARDER's access to it.
 *
 * NOT the same gate as `authorPersonalityId`, despite both taking the
 * forwarder's id. That one asks whether this viewer may load a PERSONALITY and
 * answers `undefined` for every forward of a human message; this one asks
 * whether they may view a CHANNEL. Reusing the personality gate here would
 * suppress the channel name in the common case while never answering the
 * question it was reached for.
 *
 * `permissionsFor(snowflake)` returns null when the member can't be resolved
 * from cache; that fails closed here rather than spending a fetch to rescue
 * it — a cross-guild forward is simultaneously the uncached case and the
 * no-access case. Narrower than it sounds for the SAME-guild case: the
 * forwarder is the author of the forward, and the `GuildMembers` intent is
 * enabled (`index.ts`), so receiving that message is what caches them.
 * `LinkExtractor.verifyInvokerCanAccessSource` does spend the fetch, and the
 * divergence is deliberate — it gates whether to expand message CONTENT,
 * where this decides whether to name a channel.
 *
 * A DM origin returns `undefined` before either check: it has no channel to
 * name, and `permissionsFor` does not exist on a DM channel at all.
 *
 * A PRIVATE THREAD needs a second check that `permissionsFor` structurally
 * cannot supply — see `satisfiesPrivateThreadMembership`'s docstring for why.
 * Same gap, same fix, same fail-closed posture as
 * `LinkExtractor.verifyInvokerCanAccessSource`.
 *
 * SHARED, and deliberately caller-agnostic: more than one prompt-bound path
 * depends on this exact gate, and it is exported so those paths cannot drift
 * apart. Two copies of this decision silently disagreeing is the bug that
 * caused it to be extracted. Do not specialize it for one caller — a caller
 * that needs different behaviour needs its own function, not a parameter here.
 */
export async function resolveOriginChannelName(
  channel: TextBasedChannel,
  forwarderId: string
): Promise<string | undefined> {
  if (channel.isDMBased()) {
    return undefined;
  }
  const permissions = channel.permissionsFor(forwarderId);
  if (permissions?.has(PermissionFlagsBits.ViewChannel) !== true) {
    return undefined;
  }
  if (!(await satisfiesPrivateThreadMembership(channel, forwarderId))) {
    return undefined;
  }
  return channel.name;
}

/**
 * Maps a forward's ALREADY-FETCHED original to one of our internal personality
 * ids, or `undefined` when the original wasn't authored by a character.
 *
 * The three parameters are not interchangeable, which is why this is one named
 * type rather than a shape re-declared per call site:
 *
 * - `original` — the ORIGINAL message, already fetched. Never the forward:
 *   re-deriving the original inside an implementation means fetching again,
 *   and the reply-shaped lookup that would do so reads the channel the forward
 *   LANDED in, which is wrong for every cross-channel forward.
 * - `viewerId` — the FORWARDER, who is who the attribution is shown to.
 *   Resolving against anyone else's id could name a character they cannot
 *   otherwise see, so this is the access-control input.
 * - `isDM` — whether the ORIGIN channel is a DM, never the landing channel's
 *   surface. An implementation decides what shape the original must have (DM =
 *   bot-user author, guild = webhook author), so classifying by the landing
 *   channel silently rejects both cross-surface directions.
 */
export type ForwardedAuthorPersonalityResolver = (
  original: Message,
  viewerId: string,
  isDM: boolean
) => Promise<string | undefined>;

export async function resolveForwardedOrigin(
  message: Message,
  resolveAuthorPersonalityId?: ForwardedAuthorPersonalityResolver
): Promise<ForwardedOrigin | undefined> {
  if (!isForwardedMessage(message)) {
    return undefined;
  }

  const origin: ForwardedOrigin = {};

  // Snapshot timestamp: free, and independent of the fetch below.
  const snapshotCreatedTimestamp = getSnapshots(message)?.first()?.createdTimestamp;
  if (snapshotCreatedTimestamp !== null && snapshotCreatedTimestamp !== undefined) {
    origin.timestamp = new Date(snapshotCreatedTimestamp).toISOString();
  }

  const reference = message.reference;
  if (reference?.messageId !== undefined) {
    try {
      // A forward can originate in another channel, so the reference's own
      // channelId is authoritative — reusing message.channel would fetch the
      // right id against the wrong channel and throw.
      const channel =
        reference.channelId === message.channel.id
          ? message.channel
          : await message.client.channels.fetch(reference.channelId);

      if (channel?.isTextBased() === true) {
        const original = await channel.messages.fetch(reference.messageId);
        origin.authorName = resolveOriginAuthorName(original, message.client.user?.tag);
        origin.authorId = original.author.id;

        // Snapshot data is present on the live MESSAGE_CREATE event but can be
        // ABSENT on a REST re-fetch (see extractForwardedContent), which is
        // exactly what the extended-context path does — so the snapshot
        // timestamp above may be missing there.
        //
        // Equal by construction, not coincidence: a snapshot carries no id of
        // its own, so discord.js builds it with the reference's messageId as its
        // id and derives createdTimestamp from that snowflake. The original we
        // just fetched IS that message, so both timestamps decode from one
        // snowflake — an exact fallback, not an approximation. Snapshot still
        // wins when present: it survives a deleted original, and this branch
        // cannot run without a successful fetch.
        origin.timestamp ??= original.createdAt.toISOString();

        // The internal id the rendered `from_id` carries. Handed the ORIGINAL
        // that was just fetched, never the forward: a resolver that re-derives
        // it would have to fetch again, and the obvious way to do that (the
        // reply-shaped lookup) reads the wrong channel for a cross-channel
        // forward and fails silently.
        if (resolveAuthorPersonalityId !== undefined) {
          origin.authorPersonalityId = await resolveAuthorPersonalityId(
            original,
            // The FORWARDER, not the original's author — the latter is the
            // webhook itself, which would make the access check meaningless.
            message.author.id,
            // The ORIGIN channel's surface, never the forward's landing
            // channel: the validator decides what shape the ORIGINAL must
            // have (DM = bot-user author, guild = webhook author), so a
            // cross-surface forward classified by the landing channel
            // silently rejects both directions.
            //
            // Narrower than `resolveOriginChannelName`'s `isDMBased()` on
            // purpose, and the two are not interchangeable: that one asks
            // "is there a channel to name", where a group DM answers no, while
            // this one asks "which author shape must the ORIGINAL have", where
            // a group DM is neither of the two shapes the validator knows.
            // Widening this to `isDMBased()` would assert the bot-user-author
            // shape for a surface that has never been observed to produce it.
            channel.type === ChannelType.DM
          );
        }

        // LAST of the independent steps on purpose. This one reaches further
        // than its neighbours — `permissionsFor`, `isThread` and the private
        // thread's `members.fetch` are more surface than a property read — and
        // everything above shares one outer catch. Resolving it last means a
        // throw here costs only the channel name, instead of also discarding
        // the timestamp fallback and the personality id that were already in
        // hand. Each field stays independently resolved, as the docstring says.
        origin.channelName = await resolveOriginChannelName(channel, message.author.id);
      }
    } catch (error) {
      logger.debug(
        { err: error, messageId: message.id },
        'Could not resolve forwarded origin; quote stays unattributed'
      );
    }
  }

  return origin.timestamp !== undefined || origin.authorName !== undefined ? origin : undefined;
}
