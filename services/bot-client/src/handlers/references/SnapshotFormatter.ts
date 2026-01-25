/**
 * Snapshot Formatter
 *
 * Formats Discord message snapshots (from forwarded messages) into referenced messages
 */

import type { Message, APIEmbed, MessageSnapshot } from 'discord.js';
import type { ReferencedMessage } from '@tzurot/common-types';
import {
  extractDiscordEnvironment,
  formatEnvironmentForPrompt,
} from '../../utils/discordContext.js';
import { extractAttachments } from '../../utils/attachmentExtractor.js';
import { extractEmbedImages } from '../../utils/embedImageExtractor.js';
import { EmbedParser } from '../../utils/EmbedParser.js';

/**
 * Service for formatting message snapshots into referenced messages
 */
export class SnapshotFormatter {
  /**
   * Format a message snapshot into a referenced message
   * @param snapshot - Message snapshot from forwarded message
   * @param referenceNumber - Reference number for this message
   * @param forwardedFrom - Original message that contained this snapshot
   * @returns Formatted referenced message with isForwarded flag
   */
  formatSnapshot(
    snapshot: MessageSnapshot,
    referenceNumber: number,
    forwardedFrom: Message
  ): ReferencedMessage {
    // Extract location context from the forwarding message (since snapshot doesn't have it)
    const environment = extractDiscordEnvironment(forwardedFrom);
    const locationContext = formatEnvironmentForPrompt(environment);

    // Process regular attachments from snapshot
    const regularAttachments =
      snapshot.attachments !== undefined && snapshot.attachments !== null
        ? extractAttachments(snapshot.attachments)
        : undefined;

    // Extract images from snapshot embeds (for vision model processing)
    const embedImages = extractEmbedImages(snapshot.embeds);

    // Combine both types of attachments
    const allAttachments = [...(regularAttachments ?? []), ...(embedImages ?? [])];

    // Process embeds from snapshot (XML format)
    const embedString =
      snapshot.embeds !== undefined && snapshot.embeds !== null && snapshot.embeds.length > 0
        ? snapshot.embeds
            .map((embed: APIEmbed | { toJSON(): APIEmbed }, index: number) => {
              const numAttr = snapshot.embeds.length > 1 ? ` number="${index + 1}"` : '';
              // Convert embed to APIEmbed format (some embeds need .toJSON(), snapshots already have it as plain object)
              const apiEmbed: APIEmbed =
                'toJSON' in embed && typeof embed.toJSON === 'function'
                  ? embed.toJSON()
                  : (embed as APIEmbed);
              return `<embed${numAttr}>\n${EmbedParser.parseEmbed(apiEmbed)}\n</embed>`;
            })
            .join('\n')
        : '';

    return {
      referenceNumber,
      discordMessageId: forwardedFrom.id, // Use forward message ID (snapshot doesn't have its own)
      webhookId: undefined,
      discordUserId: 'unknown', // Snapshots don't include author info
      authorUsername: 'Unknown User',
      authorDisplayName: 'Unknown User',
      content: snapshot.content || '',
      embeds: embedString,
      timestamp: snapshot.createdTimestamp
        ? new Date(snapshot.createdTimestamp).toISOString()
        : forwardedFrom.createdAt.toISOString(),
      locationContext: `${locationContext} (forwarded message)`,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      isForwarded: true,
    };
  }
}
