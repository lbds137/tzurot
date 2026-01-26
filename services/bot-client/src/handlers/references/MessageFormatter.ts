/**
 * Message Formatter
 *
 * Formats Discord messages into referenced messages with full context.
 * Handles both regular messages and forwarded messages (extracts from snapshots).
 */

import type { Message } from 'discord.js';
import { type ReferencedMessage, formatLocationAsXml } from '@tzurot/common-types';
import { extractDiscordEnvironment } from '../../utils/discordContext.js';
import { extractAttachments } from '../../utils/attachmentExtractor.js';
import { extractEmbedImages } from '../../utils/embedImageExtractor.js';
import { EmbedParser } from '../../utils/EmbedParser.js';
import { TranscriptRetriever } from './TranscriptRetriever.js';
import {
  isForwardedMessage,
  hasForwardedSnapshots,
  extractForwardedAttachments,
  extractForwardedContent,
} from '../../utils/forwardedMessageUtils.js';

/**
 * Service for formatting Discord messages into referenced messages
 */
export class MessageFormatter {
  constructor(private readonly transcriptRetriever: TranscriptRetriever) {}

  /**
   * Format a Discord message as a referenced message
   * @param message - Discord message
   * @param referenceNumber - Reference number
   * @param isForwardedFlag - Whether this is a forwarded message snapshot (passed from caller)
   * @returns Formatted referenced message
   */
  async formatMessage(
    message: Message,
    referenceNumber: number,
    isForwardedFlag?: boolean
  ): Promise<ReferencedMessage> {
    // Extract full Discord environment context (server, category, channel, thread)
    const environment = extractDiscordEnvironment(message);

    // Format location context as XML using the shared formatter (DRY with current message context)
    const locationContext = formatLocationAsXml(environment);

    // Detect if this message is forwarded (either by flag or by checking reference type)
    const messageIsForwarded = isForwardedFlag ?? isForwardedMessage(message);

    // Extract attachments - handle forwarded messages by extracting from snapshots
    let allAttachments: ReturnType<typeof extractAttachments> extends infer T
      ? NonNullable<T>
      : never = [];
    let messageContent = message.content;

    if (messageIsForwarded && hasForwardedSnapshots(message)) {
      // Forwarded message with snapshots - extract from snapshots
      const forwardedAttachments = extractForwardedAttachments(message);
      allAttachments = forwardedAttachments;

      // Get content from snapshot (forwarded messages often have empty main content)
      messageContent = extractForwardedContent(message);
    } else {
      // Regular message or forwarded without snapshots - extract normally
      const regularAttachments = extractAttachments(message.attachments);
      const embedImages = extractEmbedImages(message.embeds);
      allAttachments = [...(regularAttachments ?? []), ...(embedImages ?? [])];
    }

    // Check if any attachments are voice messages with transcripts (Redis cache or database)
    // For forwarded voice messages, use the FORWARDING message's ID for lookup
    // because that's what VoiceTranscriptionService stored the transcript under
    let contentWithTranscript = messageContent;
    if (allAttachments.length > 0) {
      const transcripts: string[] = [];

      for (const attachment of allAttachments) {
        if (attachment.isVoiceMessage === true) {
          // Use forwarding message ID for lookup - transcript was stored under this ID
          const transcript = await this.transcriptRetriever.retrieveTranscript(
            message.id,
            attachment.url
          );
          if (transcript !== undefined && transcript !== null && transcript.length > 0) {
            transcripts.push(transcript);
          }
        }
      }

      // Append transcripts to content if found
      if (transcripts.length > 0) {
        const transcriptText = transcripts.join('\n\n');
        contentWithTranscript = messageContent
          ? `${messageContent}\n\n[Voice transcript]: ${transcriptText}`
          : `[Voice transcript]: ${transcriptText}`;
      }
    }

    return {
      referenceNumber,
      discordMessageId: message.id,
      webhookId: message.webhookId ?? undefined,
      discordUserId: message.author.id,
      authorUsername: message.author.username,
      authorDisplayName: message.author.displayName ?? message.author.username,
      content: contentWithTranscript,
      embeds: EmbedParser.parseMessageEmbeds(message),
      timestamp: message.createdAt.toISOString(),
      locationContext,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      isForwarded: messageIsForwarded || undefined,
    };
  }
}
