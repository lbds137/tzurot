/**
 * Message Formatter
 *
 * Formats Discord messages into referenced messages with full context
 */

import type { Message } from 'discord.js';
import { type ReferencedMessage, formatLocationAsXml } from '@tzurot/common-types';
import { extractDiscordEnvironment } from '../../utils/discordContext.js';
import { extractAttachments } from '../../utils/attachmentExtractor.js';
import { extractEmbedImages } from '../../utils/embedImageExtractor.js';
import { EmbedParser } from '../../utils/EmbedParser.js';
import { TranscriptRetriever } from './TranscriptRetriever.js';

/**
 * Service for formatting Discord messages into referenced messages
 */
export class MessageFormatter {
  constructor(private readonly transcriptRetriever: TranscriptRetriever) {}

  /**
   * Format a Discord message as a referenced message
   * @param message - Discord message
   * @param referenceNumber - Reference number
   * @param isForwarded - Whether this is a forwarded message snapshot
   * @returns Formatted referenced message
   */
  async formatMessage(
    message: Message,
    referenceNumber: number,
    isForwarded?: boolean
  ): Promise<ReferencedMessage> {
    // Extract full Discord environment context (server, category, channel, thread)
    const environment = extractDiscordEnvironment(message);

    // Format location context as XML using the shared formatter (DRY with current message context)
    const locationContext = formatLocationAsXml(environment);

    // Extract regular attachments (files, images, audio, etc.)
    const regularAttachments = extractAttachments(message.attachments);

    // Extract images from embeds (for vision model processing)
    const embedImages = extractEmbedImages(message.embeds);

    // Combine both types of attachments
    const allAttachments = [...(regularAttachments ?? []), ...(embedImages ?? [])];

    // Check if any attachments are voice messages with transcripts (Redis cache or database)
    let contentWithTranscript = message.content;
    if (regularAttachments && regularAttachments.length > 0) {
      const transcripts: string[] = [];

      for (const attachment of regularAttachments) {
        if (
          attachment.isVoiceMessage !== undefined &&
          attachment.isVoiceMessage !== null &&
          attachment.isVoiceMessage === true
        ) {
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
        contentWithTranscript = message.content
          ? `${message.content}\n\n[Voice transcript]: ${transcriptText}`
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
      isForwarded: isForwarded ?? undefined,
    };
  }
}
