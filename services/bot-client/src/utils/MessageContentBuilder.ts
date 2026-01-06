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
import { MessageReferenceType } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { AttachmentMetadata } from '@tzurot/common-types';
import { extractAttachments } from './attachmentExtractor.js';
import { extractEmbedImages } from './embedImageExtractor.js';
import { EmbedParser } from './EmbedParser.js';

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

  // Process forwarded voice messages first (use original message ID for DB lookup)
  if (isForwarded && snapshotAttachments.length > 0 && getTranscript !== undefined) {
    for (const attachment of snapshotAttachments) {
      if (attachment.isVoiceMessage === true) {
        hasVoiceMessage = true;

        // Use original message ID for forwarded voice messages
        // This ensures DB lookup works even after Redis cache expires
        if (originalMessageId !== undefined) {
          const transcript = await getTranscript(originalMessageId, attachment.url);
          if (transcript !== null && transcript.length > 0) {
            voiceTranscripts.push(transcript);
            continue;
          }
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
export interface BuildContentOptions {
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
export interface BuildContentResult {
  /** The comprehensive text content */
  content: string;
  /** Extracted attachment metadata (for vision processing) */
  attachments: AttachmentMetadata[];
  /** Whether the message contains a voice message */
  hasVoiceMessage: boolean;
  /** Whether the message is a forwarded message */
  isForwarded: boolean;
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
export async function buildMessageContent(
  message: Message,
  options: BuildContentOptions = {}
): Promise<BuildContentResult> {
  const { includeEmbeds = true, includeAttachments = true, getTranscript } = options;

  const contentParts: string[] = [];
  let isForwarded = false;

  // Collect attachments from forwarded message snapshots
  const snapshotAttachments: AttachmentMetadata[] = [];

  // Check if this is a forwarded message
  if (
    message.reference?.type === MessageReferenceType.Forward &&
    message.messageSnapshots !== undefined &&
    message.messageSnapshots.size > 0
  ) {
    isForwarded = true;
    // For forwarded messages, extract content from snapshots
    for (const snapshot of message.messageSnapshots.values()) {
      if (snapshot.content) {
        contentParts.push(`[Forwarded message]: ${snapshot.content}`);
      }

      // Extract attachments from snapshot (critical for forwarded images!)
      // Wrapped in try-catch to prevent partial failures from breaking the entire loop
      try {
        if (snapshot.attachments !== undefined && snapshot.attachments !== null) {
          const extracted = extractAttachments(snapshot.attachments);
          if (extracted) {
            snapshotAttachments.push(...extracted);
          }
        }

        // Extract images from snapshot embeds
        const snapshotEmbedImages = extractEmbedImages(snapshot.embeds);
        if (snapshotEmbedImages) {
          snapshotAttachments.push(...snapshotEmbedImages);
        }
      } catch (error) {
        logger.warn(
          { messageId: message.id, error },
          '[MessageContentBuilder] Failed to extract snapshot attachments'
        );
      }

      // Process snapshot embeds
      if (includeEmbeds && snapshot.embeds !== undefined && snapshot.embeds.length > 0) {
        const embedText = snapshot.embeds
          .map((embed, index) => {
            const embedNumber = snapshot.embeds.length > 1 ? ` ${index + 1}` : '';
            // Snapshot embeds are already APIEmbed format (or have toJSON method)
            const apiEmbed: APIEmbed =
              'toJSON' in embed && typeof embed.toJSON === 'function'
                ? embed.toJSON()
                : (embed as unknown as APIEmbed);
            return `### Forwarded Embed${embedNumber}\n\n${EmbedParser.parseEmbed(apiEmbed)}`;
          })
          .join('\n\n---\n\n');
        if (embedText) {
          contentParts.push(embedText);
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
  const { hasVoiceMessage, voiceTranscripts, nonVoiceAttachments } = await processVoiceAttachments({
    messageId: message.id,
    originalMessageId: message.reference?.messageId,
    snapshotAttachments,
    regularAttachments,
    embedImages,
    isForwarded,
    getTranscript,
  });

  // Add voice transcripts to content
  if (voiceTranscripts.length > 0) {
    const transcriptText = voiceTranscripts.join('\n\n');
    contentParts.push(`[Voice transcript]: ${transcriptText}`);
  }

  // Add attachment descriptions for non-voice attachments
  if (includeAttachments && nonVoiceAttachments.length > 0) {
    const attachmentDescriptions = nonVoiceAttachments.map(a => {
      const type = a.contentType ?? 'file';
      const name = a.name ?? 'attachment';
      return `[${type}: ${name}]`;
    });
    contentParts.push(`[Attachments: ${attachmentDescriptions.join(', ')}]`);
  }

  // Add embed content
  if (includeEmbeds && message.embeds !== undefined && message.embeds.length > 0) {
    const embedText = EmbedParser.parseMessageEmbeds(message);
    if (embedText) {
      contentParts.push(embedText);
    }
  }

  const content = contentParts.join('\n\n');

  return {
    content,
    attachments: allAttachments,
    hasVoiceMessage,
    isForwarded,
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
 * Check if a message has meaningful content (text, attachments, or embeds)
 *
 * @param message - Discord message
 * @returns True if message has content
 */
export function hasMessageContent(message: Message): boolean {
  return (
    (message.content !== undefined && message.content.length > 0) ||
    message.attachments.size > 0 ||
    (message.embeds !== undefined && message.embeds.length > 0) ||
    (message.messageSnapshots !== undefined && message.messageSnapshots.size > 0)
  );
}
