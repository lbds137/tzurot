/**
 * Message Formatter
 *
 * Formats Discord messages into referenced messages with full context.
 * Handles both regular messages and forwarded messages (extracts from snapshots).
 */

import type { Message } from 'discord.js';
import { type ReferencedMessage, formatLocationAsXml, createLogger } from '@tzurot/common-types';

const logger = createLogger('MessageFormatter');
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

/** Attachment array type (non-nullable return from extractAttachments) */
type AttachmentList = NonNullable<ReturnType<typeof extractAttachments>>;

/**
 * Service for formatting Discord messages into referenced messages
 */
export class MessageFormatter {
  constructor(private readonly transcriptRetriever: TranscriptRetriever) {}

  /**
   * Resolve message content and attachments, handling forwarded vs regular messages
   */
  private resolveMessageContent(
    message: Message,
    isForwarded: boolean
  ): { content: string; attachments: AttachmentList } {
    if (isForwarded && hasForwardedSnapshots(message)) {
      return {
        content: extractForwardedContent(message),
        attachments: extractForwardedAttachments(message),
      };
    }

    const regularAttachments = extractAttachments(message.attachments);
    const embedImages = extractEmbedImages(message.embeds);
    return {
      content: message.content,
      attachments: [...(regularAttachments ?? []), ...(embedImages ?? [])],
    };
  }

  /**
   * Append voice transcripts to message content (from Redis cache or database)
   */
  private async appendVoiceTranscripts(
    content: string,
    attachments: AttachmentList,
    messageId: string
  ): Promise<string> {
    if (attachments.length === 0) {
      return content;
    }

    const transcripts: string[] = [];
    for (const attachment of attachments) {
      if (attachment.isVoiceMessage !== true) {
        continue;
      }

      const transcript = await this.transcriptRetriever.retrieveTranscript(
        messageId,
        attachment.url
      );
      if (transcript !== undefined && transcript !== null && transcript.length > 0) {
        transcripts.push(transcript);
      } else {
        logger.debug(
          { messageId, attachmentUrl: attachment.url },
          '[MessageFormatter] Voice transcript not found for attachment'
        );
      }
    }

    if (transcripts.length === 0) {
      return content;
    }

    const transcriptText = transcripts.join('\n\n');
    return content
      ? `${content}\n\n[Voice transcript]: ${transcriptText}`
      : `[Voice transcript]: ${transcriptText}`;
  }

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
    const environment = extractDiscordEnvironment(message);
    const locationContext = formatLocationAsXml(environment);
    const messageIsForwarded = isForwardedFlag ?? isForwardedMessage(message);

    const { content, attachments } = this.resolveMessageContent(message, messageIsForwarded);
    const contentWithTranscript = await this.appendVoiceTranscripts(
      content,
      attachments,
      message.id
    );

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
      attachments: attachments.length > 0 ? attachments : undefined,
      isForwarded: messageIsForwarded || undefined,
    };
  }
}
