/* eslint-disable complexity, max-depth -- Inherent complexity from handling multiple content types (attachments, embeds, voice, forwarded) */
/**
 * Message Content Builder
 *
 * Builds comprehensive text content from Discord messages, including
 * attachments, embeds, and voice transcripts.
 *
 * IMPORTANT: This is the SINGLE SOURCE OF TRUTH for extracting content from Discord messages.
 * Both main message handling and extended context MUST use this utility to ensure consistency.
 *
 * Used by:
 * - DiscordChannelFetcher (extended context messages)
 * - HistoryLinkResolver (inline link resolution)
 *
 * This utility handles:
 * - Regular message content
 * - Forwarded message snapshots (content, attachments, embeds)
 * - Voice message transcripts
 * - Embed parsing
 * - Attachment extraction (from message AND from forwarded snapshots)
 *
 * @see SnapshotFormatter - Uses similar logic for referenced message formatting
 *      If adding features here, consider if SnapshotFormatter needs the same updates.
 */

import type { Message, APIEmbed } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { AttachmentMetadata } from '@tzurot/common-types';
import { extractAttachments } from './attachmentExtractor.js';
import { extractEmbedImages } from './embedImageExtractor.js';
import { EmbedParser } from './EmbedParser.js';
import {
  isForwardedMessage,
  hasForwardedSnapshots,
  getSnapshots,
  extractForwardedAttachments,
  extractForwardedContent,
} from './forwardedMessageUtils.js';

const logger = createLogger('MessageContentBuilder');

/**
 * Result of processing voice attachments
 */
interface VoiceProcessingResult {
  /** Whether any voice message was found */
  hasVoiceMessage: boolean;
  /** Retrieved voice transcripts */
  voiceTranscripts: string[];
  /** Attachments that are not voice messages (or voice without transcript) */
  nonVoiceAttachments: AttachmentMetadata[];
}

/**
 * Options for processing voice attachments
 */
interface VoiceProcessingOptions {
  /** The message ID (used for regular voice messages) */
  messageId: string;
  /** The original message ID for forwarded messages */
  originalMessageId: string | undefined;
  /** Attachments from forwarded message snapshots */
  snapshotAttachments: AttachmentMetadata[];
  /** Regular message attachments (may be undefined if none) */
  regularAttachments: AttachmentMetadata[] | undefined;
  /** Images extracted from embeds (may be undefined if none) */
  embedImages: AttachmentMetadata[] | undefined;
  /** Whether this is a forwarded message */
  isForwarded: boolean;
  /** Optional transcript retriever function */
  getTranscript?: (discordMessageId: string, attachmentUrl: string) => Promise<string | null>;
}

/**
 * Process attachments to extract voice transcripts and categorize attachments
 *
 * Handles both forwarded voice messages (using original message ID for DB lookup)
 * and regular voice messages (using message ID).
 *
 * @param options - Voice processing options
 * @returns Voice processing result with transcripts and categorized attachments
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- pre-existing
async function processVoiceAttachments(
  options: VoiceProcessingOptions
): Promise<VoiceProcessingResult> {
  const {
    messageId,
    originalMessageId,
    snapshotAttachments,
    regularAttachments,
    embedImages,
    isForwarded,
    getTranscript,
  } = options;
  let hasVoiceMessage = false;
  const voiceTranscripts: string[] = [];
  const nonVoiceAttachments: AttachmentMetadata[] = [];

  // Process forwarded voice messages first
  // Use the FORWARDING message's ID for DB lookup (not the original message ID)
  // because that's what VoiceTranscriptionService stored the transcript under
  if (isForwarded && snapshotAttachments.length > 0 && getTranscript !== undefined) {
    for (const attachment of snapshotAttachments) {
      if (attachment.isVoiceMessage === true) {
        hasVoiceMessage = true;

        // Use forwarding message ID - transcript was stored under this ID when originally processed
        // The original message may be from a different server and never in our DB
        const transcript = await getTranscript(messageId, attachment.url);
        if (transcript !== null && transcript.length > 0) {
          voiceTranscripts.push(transcript);
          continue;
        }

        // No transcript available
        nonVoiceAttachments.push(attachment);
        logger.debug(
          { messageId, originalMessageId, duration: attachment.duration },
          '[MessageContentBuilder] Forwarded voice message without transcript'
        );
      } else {
        nonVoiceAttachments.push(attachment);
      }
    }
  } else {
    // Non-forwarded: add snapshot attachments directly to non-voice list
    nonVoiceAttachments.push(...snapshotAttachments);
  }

  // Process regular attachments (direct message voice messages)
  if (regularAttachments && regularAttachments.length > 0) {
    for (const attachment of regularAttachments) {
      if (attachment.isVoiceMessage === true) {
        hasVoiceMessage = true;

        // Try to get transcript if retriever is provided
        if (getTranscript !== undefined) {
          const transcript = await getTranscript(messageId, attachment.url);
          if (transcript !== null && transcript.length > 0) {
            voiceTranscripts.push(transcript);
            continue;
          }
        }

        // No transcript available - include in non-voice attachments
        nonVoiceAttachments.push(attachment);
        logger.debug(
          { messageId, duration: attachment.duration },
          '[MessageContentBuilder] Voice message without transcript'
        );
      } else {
        nonVoiceAttachments.push(attachment);
      }
    }
  }

  // Add embed images to non-voice attachments
  if (embedImages && embedImages.length > 0) {
    nonVoiceAttachments.push(...embedImages);
  }

  return { hasVoiceMessage, voiceTranscripts, nonVoiceAttachments };
}

/**
 * Options for building message content
 */
interface BuildContentOptions {
  /** Whether to include embed text in content */
  includeEmbeds?: boolean;
  /** Whether to include attachment descriptions in content */
  includeAttachments?: boolean;
  /** Optional async transcript retriever for voice messages */
  getTranscript?: (discordMessageId: string, attachmentUrl: string) => Promise<string | null>;
}

/**
 * Result of building message content
 */
interface BuildContentResult {
  /** The plain text content (message text, NO markdown prefixes like [Forwarded message]:) */
  content: string;
  /** Extracted attachment metadata (for vision processing) */
  attachments: AttachmentMetadata[];
  /** Whether the message contains a voice message */
  hasVoiceMessage: boolean;
  /** Whether the message is a forwarded message */
  isForwarded: boolean;
  /** Voice transcripts (separate for structured XML formatting) */
  voiceTranscripts?: string[];
  /** Embed XML strings (already formatted by EmbedParser, for <embeds> section) */
  embedsXml?: string[];
}

/**
 * Build comprehensive text content from a Discord message
 *
 * This function consolidates all message content sources:
 * - Message text content
 * - Attachment descriptions
 * - Embed content
 * - Voice message transcripts (if retriever provided)
 * - Forwarded message content
 *
 * @param message - Discord message
 * @param options - Build options
 * @returns Comprehensive content and metadata
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- pre-existing
export async function buildMessageContent(
  message: Message,
  options: BuildContentOptions = {}
): Promise<BuildContentResult> {
  const { includeEmbeds = true, includeAttachments = true, getTranscript } = options;

  const contentParts: string[] = [];
  let isForwarded = false;

  // Collect attachments from forwarded message snapshots
  const snapshotAttachments: AttachmentMetadata[] = [];

  // Collect embeds separately (for structured XML formatting, not markdown mess)
  const embedsXml: string[] = [];

  // Check if this is a forwarded message (using centralized utility)
  if (isForwardedMessage(message)) {
    isForwarded = true;

    // Extract content from forwarded message (handles missing snapshots gracefully)
    const forwardedTextContent = extractForwardedContent(message);
    if (forwardedTextContent.length > 0) {
      contentParts.push(forwardedTextContent);
    }

    // Extract attachments from forwarded message snapshots
    // Uses centralized utility that handles all snapshot attachment extraction
    if (hasForwardedSnapshots(message)) {
      try {
        const forwardedAttachments = extractForwardedAttachments(message);
        snapshotAttachments.push(...forwardedAttachments);
      } catch (error) {
        logger.warn(
          { messageId: message.id, error },
          '[MessageContentBuilder] Failed to extract forwarded attachments'
        );
      }

      // Process snapshot embeds - collect as XML for structured formatting
      const snapshots = getSnapshots(message);
      if (includeEmbeds && snapshots !== undefined) {
        for (const snapshot of snapshots.values()) {
          if (snapshot.embeds !== undefined && snapshot.embeds.length > 0) {
            for (let index = 0; index < snapshot.embeds.length; index++) {
              const embed = snapshot.embeds[index];
              const numAttr = snapshot.embeds.length > 1 ? ` number="${index + 1}"` : '';
              // Snapshot embeds are already APIEmbed format (or have toJSON method)
              const apiEmbed: APIEmbed =
                'toJSON' in embed && typeof embed.toJSON === 'function'
                  ? embed.toJSON()
                  : (embed as unknown as APIEmbed);
              embedsXml.push(`<embed${numAttr}>\n${EmbedParser.parseEmbed(apiEmbed)}\n</embed>`);
            }
          }
        }
      }
    }
  }

  // Add main message content
  if (message.content) {
    contentParts.push(message.content);
  }

  // Extract and combine attachments from all sources:
  // 1. Forwarded message snapshot attachments (extracted above)
  // 2. Regular attachments on the main message
  // 3. Embed images from main message embeds
  const regularAttachments = extractAttachments(message.attachments);
  const embedImages = extractEmbedImages(message.embeds);
  const allAttachments: AttachmentMetadata[] = [
    ...snapshotAttachments,
    ...(regularAttachments ?? []),
    ...(embedImages ?? []),
  ];

  // Process voice messages and categorize attachments
  // Voice transcripts are collected separately for structured XML formatting
  const { hasVoiceMessage, voiceTranscripts, nonVoiceAttachments } = await processVoiceAttachments({
    messageId: message.id,
    originalMessageId: message.reference?.messageId,
    snapshotAttachments,
    regularAttachments,
    embedImages,
    isForwarded,
    getTranscript,
  });

  // Voice transcripts are returned separately - no [Voice transcript]: prefix
  // The XML formatter will add proper <voice_transcripts> section

  // Add attachment descriptions for non-voice attachments
  if (includeAttachments && nonVoiceAttachments.length > 0) {
    const attachmentDescriptions = nonVoiceAttachments.map(a => {
      const type = a.contentType ?? 'file';
      const name = a.name ?? 'attachment';
      return `[${type}: ${name}]`;
    });
    contentParts.push(`[Attachments: ${attachmentDescriptions.join(', ')}]`);
  }

  // Process main message embeds - collect as XML for structured formatting
  if (includeEmbeds && message.embeds !== undefined && message.embeds.length > 0) {
    for (let index = 0; index < message.embeds.length; index++) {
      const embed = message.embeds[index];
      const numAttr = message.embeds.length > 1 ? ` number="${index + 1}"` : '';
      embedsXml.push(`<embed${numAttr}>\n${EmbedParser.parseEmbed(embed.toJSON())}\n</embed>`);
    }
  }

  const content = contentParts.join('\n\n');

  return {
    content,
    attachments: allAttachments,
    hasVoiceMessage,
    isForwarded,
    // Return voice transcripts and embeds separately for structured XML formatting
    voiceTranscripts: voiceTranscripts.length > 0 ? voiceTranscripts : undefined,
    embedsXml: embedsXml.length > 0 ? embedsXml : undefined,
  };
}

/**
 * Format attachment metadata as a text description
 *
 * @param attachments - Attachment metadata array
 * @returns Formatted attachment description string
 */
export function formatAttachmentDescription(attachments: AttachmentMetadata[] | undefined): string {
  if (!attachments || attachments.length === 0) {
    return '';
  }

  const descriptions = attachments.map(a => {
    const type = a.contentType ?? 'file';
    const name = a.name ?? 'attachment';
    if (a.isVoiceMessage === true) {
      const duration =
        a.duration !== undefined && a.duration !== null && a.duration > 0
          ? ` (${Math.round(a.duration)}s)`
          : '';
      return `[voice message: ${name}${duration}]`;
    }
    return `[${type}: ${name}]`;
  });

  return `[Attachments: ${descriptions.join(', ')}]`;
}

/**
 * Check if a message has meaningful content (text, attachments, embeds, or is forwarded)
 *
 * Forwarded messages are always considered to have content, even if messageSnapshots
 * is empty (which can happen due to Discord API limitations or permissions).
 * The actual content extraction happens later in buildMessageContent.
 *
 * Uses centralized isForwardedMessage from forwardedMessageUtils.ts
 *
 * @param message - Discord message
 * @returns True if message has content
 */
export function hasMessageContent(message: Message): boolean {
  // Forwarded messages always have content (even if snapshots are empty)
  // This prevents filtering out forwarded images/voice where Discord may not populate snapshots
  // Uses centralized utility for consistency across codebase

  return (
    (message.content !== undefined && message.content.length > 0) ||
    message.attachments.size > 0 ||
    (message.embeds !== undefined && message.embeds.length > 0) ||
    (message.messageSnapshots !== undefined && message.messageSnapshots.size > 0) ||
    isForwardedMessage(message)
  );
}
