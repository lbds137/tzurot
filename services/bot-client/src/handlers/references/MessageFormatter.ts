/**
 * Message Formatter
 *
 * Formats Discord messages into referenced messages with full context.
 * Handles both regular messages and forwarded messages (extracts from snapshots).
 */

import type { Message } from 'discord.js';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { formatLocationAsXml } from '@tzurot/common-types/utils/environmentFormatter';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { appendVoiceTranscripts } from '@tzurot/common-types/utils/referenceEnrichment';

const logger = createLogger('MessageFormatter');
import { extractDiscordEnvironment } from '../../utils/discordContext.js';
import { extractAttachments } from '../../utils/attachmentExtractor.js';
import { extractEmbedImages } from '../../utils/embedImageExtractor.js';
import { EmbedParser } from '../../utils/EmbedParser.js';
import { type TranscriptRetriever } from './TranscriptRetriever.js';
import { classifyReferenceAuthorRole } from './authorRole.js';
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
   * Append voice transcripts to message content — shared kernel drives the
   * format; this wrapper supplies the bot-side retriever (Redis cache + DB
   * tiers) and the not-found debug log.
   */
  private async appendTranscriptsWithRetriever(
    content: string,
    attachments: AttachmentList,
    messageId: string
  ): Promise<string> {
    return appendVoiceTranscripts({
      content,
      attachments,
      discordMessageId: messageId,
      retrieve: async (discordMessageId, attachmentUrl) => {
        // The retriever is typed `string | null`; `?? null` up front keeps
        // this adapter total over `undefined` too should that ever drift.
        const transcript =
          (await this.transcriptRetriever.retrieveTranscript(discordMessageId, attachmentUrl)) ??
          null;
        if (transcript === null || transcript.length === 0) {
          logger.debug(
            { messageId: discordMessageId, attachmentUrl },
            'Voice transcript not found for attachment'
          );
        }
        return transcript;
      },
    });
  }

  /**
   * Build the RAW referenced message — every Discord-origin field, with
   * content BEFORE the voice-transcript append (the one DB/Redis-derived
   * enrichment in this formatter). Pure and synchronous; this is the shape
   * the raw assembly envelope ships so the worker-side assembler can re-run
   * the transcript enrichment itself.
   */
  buildRawReference(
    message: Message,
    referenceNumber: number,
    isForwardedFlag?: boolean
  ): { reference: ReferencedMessage; attachments: AttachmentList } {
    const environment = extractDiscordEnvironment(message);
    const locationContext = formatLocationAsXml(environment);
    const messageIsForwarded = isForwardedFlag ?? isForwardedMessage(message);

    const { content, attachments } = this.resolveMessageContent(message, messageIsForwarded);

    return {
      attachments,
      reference: {
        referenceNumber,
        discordMessageId: message.id,
        webhookId: message.webhookId ?? undefined,
        // Presence-encoded: gates the worker-side time-fallback dedup re-run.
        authorIsBot: message.author.bot === true || undefined,
        // Classified here (only bot-client has applicationId + our own id); carried to
        // both the live prompt and the stored-history snapshot so role is decided once.
        authorRole: classifyReferenceAuthorRole({
          webhookId: message.webhookId,
          authorIsBot: message.author.bot,
          applicationId: message.applicationId,
          clientUserId: message.client.user?.id,
        }),
        discordUserId: message.author.id,
        authorUsername: message.author.username,
        authorDisplayName: message.author.displayName ?? message.author.username,
        content,
        embeds: EmbedParser.parseMessageEmbeds(message),
        timestamp: message.createdAt.toISOString(),
        locationContext,
        attachments: attachments.length > 0 ? attachments : undefined,
        isForwarded: messageIsForwarded || undefined,
      },
    };
  }

  /**
   * Format a Discord message as a referenced message, returning both the
   * enriched form (voice transcripts appended) and the raw pre-enrichment
   * snapshot for the assembly envelope.
   */
  async formatMessageWithRaw(
    message: Message,
    referenceNumber: number,
    isForwardedFlag?: boolean
  ): Promise<{ enriched: ReferencedMessage; raw: ReferencedMessage }> {
    const { reference: raw, attachments } = this.buildRawReference(
      message,
      referenceNumber,
      isForwardedFlag
    );
    const contentWithTranscript = await this.appendTranscriptsWithRetriever(
      raw.content,
      attachments,
      message.id
    );
    return { raw, enriched: { ...raw, content: contentWithTranscript } };
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
    const { enriched } = await this.formatMessageWithRaw(message, referenceNumber, isForwardedFlag);
    return enriched;
  }
}
