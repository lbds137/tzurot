/**
 * Snapshot Formatter
 *
 * Formats Discord message snapshots (from forwarded messages) into referenced messages
 */

import { type Message, type APIEmbed, type MessageSnapshot } from 'discord.js';
import { UNKNOWN_USER_DISCORD_ID, UNKNOWN_USER_NAME } from '@tzurot/common-types/constants/message';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { formatLocationAsXml } from '@tzurot/common-types/utils/environmentFormatter';
import { stripBotFooters } from '@tzurot/common-types/utils/discord';
import { extractDiscordEnvironment } from '../../utils/discordContext.js';
import { extractAttachments } from '../../utils/attachmentExtractor.js';
import { extractEmbedImages } from '../../utils/embedImageExtractor.js';
import { extractSnapshotStickerImages } from '../../utils/stickerAttachments.js';
import { withSnapshotStickerDescriptions } from '../../utils/stickerPollDescriptions.js';
import { resolveOriginChannelName } from '../../utils/forwardedMessageUtils.js';
import { EmbedParser } from '../../utils/EmbedParser.js';

/** The generic marker used whenever the origin channel can't be attributed. */
const GENERIC_FORWARD_MARKER = '(forwarded message)';

/**
 * Service for formatting message snapshots into referenced messages
 */
export class SnapshotFormatter {
  /**
   * Build the forward marker appended to the snapshot's locationContext.
   *
   * Discord exposes the ORIGIN channel of a forward on `forwardedFrom.reference`
   * (a FORWARD-type MessageReference). When the bot can see that channel AND the
   * FORWARDER has access to it, we surface its name ("forwarded from #general"),
   * matching what Discord's own client shows.
   *
   * RESOLVING the channel is a CACHE read only, with no `fetch()` to rescue a
   * miss: a name is meaningful exactly when the bot is a member, which is also
   * when the channel is cached. That claim covers resolution and the
   * `permissionsFor` check, and stops there — the private-thread branch DOES
   * spend a REST call, because `satisfiesPrivateThreadMembership` fetches the
   * thread member list (see its docstring). Scoped deliberately: an unqualified
   * "no network calls here" would be false for that branch.
   *
   * Cross-server forwards (bot not a member), a forwarder who lacks
   * `ViewChannel` on the origin channel, or a private thread the forwarder isn't
   * a member of, all fall back to the generic "(forwarded message)" marker
   * rather than leaking a channel name the forwarder themselves couldn't see.
   *
   * The gate itself — DM check, forwarder-scoped `permissionsFor`, private
   * thread membership — is {@link resolveOriginChannelName}
   * (forwardedMessageUtils.ts), shared rather than duplicated: that function's
   * docstring carries the rationale for those three steps, why `permissionsFor`
   * returning null fails closed rather than spending a fetch, and why a private
   * thread needs a check `permissionsFor` structurally cannot supply.
   *
   * The cache read is this path's alone — the shared function receives an
   * already-resolved channel — which is why the bot-cached-but-forwarder-blind
   * case is stated here rather than by pointer. A cache hit says the BOT is a
   * member; it says nothing about the forwarder, and it is the forwarder whose
   * view this marker claims to reflect.
   *
   * PUBLIC, and computed by the caller rather than per snapshot: the marker
   * depends only on `forwardedFrom`, so a compound forward would otherwise
   * re-run this gate — and on the private-thread branch, re-issue its REST
   * fetch — once per snapshot for an answer that cannot change.
   */
  async buildForwardMarker(forwardedFrom: Message): Promise<string> {
    const originChannelId = forwardedFrom.reference?.channelId;
    if (originChannelId === undefined) {
      return GENERIC_FORWARD_MARKER;
    }
    const channel = forwardedFrom.client?.channels?.cache?.get(originChannelId);
    if (channel?.isTextBased() !== true) {
      return GENERIC_FORWARD_MARKER;
    }
    const name = await resolveOriginChannelName(channel, forwardedFrom.author.id);
    return name !== undefined ? `(forwarded from #${name})` : GENERIC_FORWARD_MARKER;
  }

  /**
   * Format a message snapshot into a referenced message
   * @param snapshot - Message snapshot from forwarded message
   * @param referenceNumber - Reference number for this message
   * @param forwardedFrom - Original message that contained this snapshot
   * @param forwardMarker - Origin-channel marker from {@link buildForwardMarker},
   *   resolved once per forwarded MESSAGE by the caller. Required rather than
   *   defaulted: a fallback here would silently re-introduce the per-snapshot
   *   recomputation this parameter exists to remove.
   * @returns Formatted referenced message with isForwarded flag
   */
  formatSnapshot(
    snapshot: MessageSnapshot,
    referenceNumber: number,
    forwardedFrom: Message,
    forwardMarker: string
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

    // Forwarded stickers get the same treatment — without this a forwarded
    // sticker reached the model as an image with no name behind it. The NAME
    // half renders below via withSnapshotStickerDescriptions, matching what
    // MessageFormatter does for the paths that format the containing message;
    // for a non-rasterizable (Lottie) sticker the name line is the only trace.
    const stickerImages = extractSnapshotStickerImages(snapshot);

    // Combine all attachment kinds
    const allAttachments = [
      ...(regularAttachments ?? []),
      ...(embedImages ?? []),
      ...(stickerImages ?? []),
    ];

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
      // Footers stripped per-snapshot rather than via
      // `extractForwardedContentForPrompt`: that accessor reads only the FIRST
      // snapshot, while this runs once per snapshot in a multi-snapshot
      // forward. Same reason as every other prompt-bound site — a forward of
      // one of our own replies would otherwise carry our `-# Model: …` markup
      // into a `<quote type="forward">`.
      content: withSnapshotStickerDescriptions(snapshot, stripBotFooters(snapshot.content || '')),
      embeds: embedString,
      timestamp: snapshot.createdTimestamp
        ? new Date(snapshot.createdTimestamp).toISOString()
        : forwardedFrom.createdAt.toISOString(),
      locationContext: `${locationContext} ${forwardMarker}`,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      isForwarded: true,
    };
  }
}
