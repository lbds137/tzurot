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

import type { Message, MessageSnapshot, Collection, APIEmbed } from 'discord.js';
import { MessageReferenceType } from 'discord.js';
import type { AttachmentMetadata } from '@tzurot/common-types';
import { extractAttachments } from './attachmentExtractor.js';
import { extractEmbedImages } from './embedImageExtractor.js';

/**
 * Content extracted from a forwarded message or its snapshots
 */
export interface ForwardedContentResult {
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
 * A forwarded message has message.reference.type === MessageReferenceType.Forward.
 * Note: We do NOT require messageSnapshots to be present, as Discord may not
 * always populate them due to API limitations or permissions.
 *
 * @param message - Discord message to check
 * @returns true if the message is a forwarded message
 */
export function isForwardedMessage(message: Message | null | undefined): boolean {
  if (!message) {return false;}
  return message.reference?.type === MessageReferenceType.Forward;
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
  if (!message) {return false;}
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
export function extractForwardedEmbeds(message: Message): (APIEmbed | { toJSON(): APIEmbed })[] {
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
 * Voice messages in forwarded content are detected by:
 * - contentType starting with 'audio/'
 * - duration property being present
 *
 * @param message - Discord message (should be a forwarded message)
 * @returns true if the forwarded message contains voice attachments
 */
export function hasForwardedVoiceAttachment(message: Message): boolean {
  if (!isForwardedMessage(message)) {
    return false;
  }

  const { attachments } = extractAllForwardedContent(message);

  return attachments.some(a => a.isVoiceMessage === true || a.duration !== undefined);
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
