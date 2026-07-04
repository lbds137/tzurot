/**
 * Snapshot Formatter
 *
 * Formats Discord message snapshots (from forwarded messages) into referenced messages
 */

import type { Message, APIEmbed, MessageSnapshot } from 'discord.js';
import { UNKNOWN_USER_DISCORD_ID, UNKNOWN_USER_NAME } from '@tzurot/common-types/constants/message';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { formatLocationAsXml } from '@tzurot/common-types/utils/environmentFormatter';
import { extractDiscordEnvironment } from '../../utils/discordContext.js';
import { extractAttachments } from '../../utils/attachmentExtractor.js';
import { extractEmbedImages } from '../../utils/embedImageExtractor.js';
import { EmbedParser } from '../../utils/EmbedParser.js';

/**
 * Service for formatting message snapshots into referenced messages
 */
export class SnapshotFormatter {
  /**
   * Build the forward marker appended to the snapshot's locationContext.
   *
   * Discord exposes the ORIGIN channel of a forward on `forwardedFrom.reference`
   * (a FORWARD-type MessageReference). When the bot can see that channel we
   * surface its name ("forwarded from #general"), matching what Discord's own
   * client shows. We read the client's channel CACHE only — no network `fetch()`
   * on the message-handling path: a name is meaningful exactly when the bot is a
   * member, which is also when the channel is cached. Cross-server forwards (bot
   * not a member) won't resolve and fall back to the generic "(forwarded
   * message)" marker rather than leaking a bare ID or stalling on a doomed fetch.
   */
  private buildForwardMarker(forwardedFrom: Message): string {
    const originChannelId = forwardedFrom.reference?.channelId;
    if (originChannelId === undefined) {
      return '(forwarded message)';
    }
    const channel = forwardedFrom.client?.channels?.cache?.get(originChannelId);
    if (
      channel !== undefined &&
      'name' in channel &&
      typeof channel.name === 'string' &&
      channel.name.length > 0
    ) {
      return `(forwarded from #${channel.name})`;
    }
    return '(forwarded message)';
  }

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
    // Use XML format consistent with MessageFormatter for unified formatting
    const environment = extractDiscordEnvironment(forwardedFrom);
    const locationContext = formatLocationAsXml(environment);

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

    // No authorRole: Discord message snapshots strip author identity (no applicationId
    // or bot flags), so a forwarded reference can't be classified here and resolves to
    // role="user" via the worker's name-match fallback. Known Discord-API limitation —
    // a forwarded persona voice/text message reads as user, not assistant.
    return {
      referenceNumber,
      discordMessageId: forwardedFrom.id, // Use forward message ID (snapshot doesn't have its own)
      webhookId: undefined,
      discordUserId: UNKNOWN_USER_DISCORD_ID, // Snapshots don't include author info
      authorUsername: UNKNOWN_USER_NAME,
      authorDisplayName: UNKNOWN_USER_NAME,
      content: snapshot.content || '',
      embeds: embedString,
      timestamp: snapshot.createdTimestamp
        ? new Date(snapshot.createdTimestamp).toISOString()
        : forwardedFrom.createdAt.toISOString(),
      locationContext: `${locationContext} ${this.buildForwardMarker(forwardedFrom)}`,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      isForwarded: true,
    };
  }
}
