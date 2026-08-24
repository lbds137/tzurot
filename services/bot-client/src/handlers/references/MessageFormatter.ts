/**
 * Message Formatter
 *
 * Formats Discord messages into referenced messages with full context.
 * Handles both regular messages and forwarded messages (extracts from snapshots).
 */

import type { Message } from 'discord.js';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { formatLocationAsXml } from '@tzurot/common-types/utils/environmentFormatter';
import { stripBotFooters } from '@tzurot/common-types/utils/discord';
import { extractDiscordEnvironment } from '../../utils/discordContext.js';
import { extractAttachments } from '../../utils/attachmentExtractor.js';
import { extractEmbedImages } from '../../utils/embedImageExtractor.js';
import { extractStickerImages } from '../../utils/stickerAttachments.js';
import { EmbedParser } from '../../utils/EmbedParser.js';
import { withStickerAndPollDescriptions } from '../../utils/stickerPollDescriptions.js';
import { classifyReferenceAuthorRole } from './authorRole.js';
import {
  isForwardedMessage,
  hasForwardedSnapshots,
  extractForwardedAttachments,
  extractForwardedContentForPrompt,
} from '../../utils/forwardedMessageUtils.js';
import { resolveWebhookAwareDisplayName } from '../../utils/webhookNaming.js';

/** Attachment array type (non-nullable return from extractAttachments) */
type AttachmentList = NonNullable<ReturnType<typeof extractAttachments>>;

/**
 * Service for formatting Discord messages into referenced messages
 */

export class MessageFormatter {
  /**
   * Resolve message content and attachments, handling forwarded vs regular messages.
   *
   * The result is prompt-bound: `buildRawReference` is the only caller, and its
   * output feeds both the reference envelope and the stored-history snapshot.
   * Our own footer markup (model attribution, guest mode, auto-response, ...)
   * is therefore stripped on BOTH branches — inline here via `stripBotFooters`,
   * and inside `extractForwardedContentForPrompt` for the forwarded branch —
   * so a reply never quotes footer text back at the model. The strip runs
   * BEFORE `withStickerAndPollDescriptions` so it cannot eat an appended
   * sticker/poll description.
   *
   * A message that is nothing but a standalone footer (see
   * `DiscordResponseSender.appendFooterToChunks`, which pushes the footer as
   * its own message when it doesn't fit the last chunk) strips down to empty
   * content. That ships as a contentless reference that is still present:
   * its author metadata still carries the reply signal, and this is
   * deliberate rather than a gap to fill with placeholder text.
   */
  private resolveMessageContent(
    message: Message,
    isForwarded: boolean
  ): { content: string; attachments: AttachmentList } {
    if (isForwarded && hasForwardedSnapshots(message)) {
      return {
        content: withStickerAndPollDescriptions(message, extractForwardedContentForPrompt(message)),
        attachments: extractForwardedAttachments(message),
      };
    }

    const regularAttachments = extractAttachments(message.attachments);
    const embedImages = extractEmbedImages(message.embeds);
    // Stickers ride the same synthetic-attachment path as embed images so the
    // reference gets a vision DESCRIPTION, not just the name that
    // `withStickerAndPollDescriptions` renders below. Both together is the
    // established shape — it is what `MessageContentBuilder` does for the
    // triggering message; this path was simply missing the image half.
    const stickerImages = extractStickerImages(message);
    return {
      // Without the descriptions, replying to a sticker-only or poll-only
      // message renders an empty [Reference N] block.
      content: withStickerAndPollDescriptions(message, stripBotFooters(message.content)),
      attachments: [
        ...(regularAttachments ?? []),
        ...(embedImages ?? []),
        ...(stickerImages ?? []),
      ],
    };
  }

  /**
   * Build the RAW referenced message — every Discord-origin field, with
   * content BEFORE any transcript enrichment. Pure and synchronous; this is
   * the shape the raw assembly envelope ships so the worker-side assembler
   * can run the transcript enrichment itself.
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
        // A webhook author's displayName IS the webhook username, which for
        // our own characters carries the bot suffix ("Name · Bot"). Both
        // downstream renderers (live references and stored-history replay)
        // fall through persona resolution to this raw name for
        // webhook-authored quotes, so stripping happens HERE at the producer
        // — the one site both consumers share, and the only service that
        // knows the bot's tag. Foreign webhook names carry no suffix and
        // pass through unchanged; humans are untouched.
        authorDisplayName: resolveWebhookAwareDisplayName(
          message.author.displayName ?? message.author.username,
          message.webhookId,
          message.client.user?.tag
        ),
        content,
        embeds: EmbedParser.parseMessageEmbeds(message),
        timestamp: message.createdAt.toISOString(),
        locationContext,
        attachments: attachments.length > 0 ? attachments : undefined,
        isForwarded: messageIsForwarded || undefined,
      },
    };
  }
}
