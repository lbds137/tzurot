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
  type Message,
  type MessageSnapshot,
  type Collection,
  type APIEmbed,
  MessageReferenceType,
} from 'discord.js';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { extractAttachments } from './attachmentExtractor.js';
import { extractEmbedImages } from './embedImageExtractor.js';
import { isVoiceAttachment } from './voiceAttachment.js';

/**
 * Content extracted from a forwarded message or its snapshots
 */
interface ForwardedContentResult {
  /** Text content from forwarded message */
  content: string;
  /** Attachments from forwarded message (files, images, voice) */
  attachments: AttachmentMetadata[];
  /** Embeds from forwarded message */
  embeds: (APIEmbed | { toJSON(): APIEmbed })[];
  /** Whether content was extracted from snapshots (vs fallback to main message) */
  fromSnapshot: boolean;
  /** Original message ID from the forward reference (if available) */
  originalMessageId: string | undefined;
}

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
  }

  return attachments;
}

/**
 * Extract embeds from a forwarded message's snapshots.
 *
 * @param message - Discord message (should be a forwarded message)
 * @returns Array of embeds from snapshots
 */
function extractForwardedEmbeds(message: Message): (APIEmbed | { toJSON(): APIEmbed })[] {
  const embeds: (APIEmbed | { toJSON(): APIEmbed })[] = [];

  const snapshots = getSnapshots(message);
  if (snapshots === undefined) {
    return embeds;
  }

  for (const snapshot of snapshots.values()) {
    if (snapshot.embeds !== undefined && snapshot.embeds.length > 0) {
      embeds.push(...snapshot.embeds);
    }
  }

  return embeds;
}

/**
 * Extract all content from a forwarded message (comprehensive extraction).
 *
 * This is the canonical method for extracting all content from a forwarded message.
 * It extracts text content, attachments, and embeds from snapshots with proper fallbacks.
 *
 * Use this when you need complete content extraction for processing.
 *
 * @param message - Discord message (should be a forwarded message)
 * @returns Comprehensive content result with all extracted data
 */
export function extractAllForwardedContent(message: Message): ForwardedContentResult {
  const hasSnapshots = hasForwardedSnapshots(message);

  if (!hasSnapshots) {
    // No snapshots - fall back to main message data
    // This handles the edge case where Discord doesn't populate snapshots
    const mainAttachments = extractAttachments(message.attachments);
    const embedImages = extractEmbedImages(message.embeds);

    return {
      content: message.content,
      attachments: [...(mainAttachments ?? []), ...(embedImages ?? [])],
      embeds: message.embeds ?? [],
      fromSnapshot: false,
      originalMessageId: message.reference?.messageId,
    };
  }

  // Extract from snapshots
  return {
    content: extractForwardedContent(message),
    attachments: extractForwardedAttachments(message),
    embeds: extractForwardedEmbeds(message),
    fromSnapshot: true,
    originalMessageId: message.reference?.messageId,
  };
}

/**
 * Check if a forwarded message has any meaningful content.
 *
 * Returns true if the forwarded message has:
 * - Text content (in snapshots or main message)
 * - Attachments (in snapshots or main message)
 * - Embeds (in snapshots or main message)
 *
 * Use this for filtering - a forwarded message is worth processing if it has content.
 *
 * @param message - Discord message (should be a forwarded message)
 * @returns true if the forwarded message has meaningful content
 */
export function hasForwardedContent(message: Message): boolean {
  if (!isForwardedMessage(message)) {
    return false;
  }

  const { content, attachments, embeds } = extractAllForwardedContent(message);

  return content.length > 0 || attachments.length > 0 || embeds.length > 0;
}

/**
 * Check if a forwarded message contains voice message attachments.
 *
 * Reads the precomputed `AttachmentMetadata.isVoiceMessage` flag rather than
 * re-running {@link isVoiceAttachment} here: `extractAllForwardedContent` →
 * `extractAttachments` already evaluated the predicate against the RAW attachment
 * (before normalizing a null content-type to `application/octet-stream`), so the
 * flag preserves the duration fallback for content-type-absent voice snapshots.
 * Calling `isVoiceAttachment` on the already-normalized metadata here would lose
 * that fallback and disagree with the flag on the very same object.
 *
 * @param message - Discord message (should be a forwarded message)
 * @returns true if the forwarded message contains voice attachments
 */
export function hasForwardedVoiceAttachment(message: Message): boolean {
  if (!isForwardedMessage(message)) {
    return false;
  }

  const { attachments } = extractAllForwardedContent(message);
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
