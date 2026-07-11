/**
 * Chunked ephemeral reply utility.
 *
 * Splits long content into Discord-safe chunks with headers,
 * sending the first as an editReply and the rest as follow-ups.
 *
 * Delivery contract: throws only if the FIRST chunk fails (nothing was
 * delivered). Once the first chunk is out, a later-chunk failure is handled
 * internally — log + best-effort notice — and does NOT throw, because the
 * caller's error handler would replace or mislabel content the user already
 * received (an editReply'd "error" banner clobbering a delivered view).
 */

import {
  MessageFlags,
  type ActionRowBuilder,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { splitMessage } from '@tzurot/common-types/utils/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from './commandContext/types.js';

const logger = createLogger('chunkedReply');

export interface ChunkedReplyOptions {
  /** Any already-acked reply surface: a component interaction (button or
   * select menu) or a deferred slash-command context. */
  interaction: ButtonInteraction | StringSelectMenuInteraction | DeferredCommandContext;
  content: string;
  header: string;
  continuedHeader: string;
  /** Component rows attached to the FIRST chunk only (follow-ups are plain). */
  components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  /** Where the FIRST chunk goes. 'editReply' (default) edits the deferred
   * reply; 'followUp' leaves the deferred reply untouched — for callers whose
   * deferred reply already carries a summary (e.g. an embed) and want the
   * chunked text appended below it as separate messages. */
  via?: 'editReply' | 'followUp';
}

/**
 * Send content as ephemeral chunked replies with headers.
 *
 * If the content fits in one message, sends a single editReply.
 * Otherwise, splits the content using paragraph-aware chunking
 * and sends the first chunk as editReply, the rest as follow-ups.
 */
export async function sendChunkedReply(options: ChunkedReplyOptions): Promise<void> {
  const { interaction, content, header, continuedHeader, components, via = 'editReply' } = options;

  const sendFirst = async (
    firstContent: string,
    rows: ActionRowBuilder<MessageActionRowComponentBuilder>[]
  ): Promise<void> => {
    if (via === 'followUp') {
      await interaction.followUp({
        content: firstContent,
        components: rows,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.editReply({ content: firstContent, components: rows });
  };

  // Use the longer header length to ensure all chunks fit
  const maxHeaderLength = Math.max(header.length, continuedHeader.length);
  const maxContentLength = DISCORD_LIMITS.MESSAGE_LENGTH - maxHeaderLength;

  if (content.length <= maxContentLength) {
    await sendFirst(`${header}${content}`, components ?? []);
    return;
  }

  // Use smart chunking that preserves paragraphs, sentences, and code blocks
  const contentChunks = splitMessage(content, maxContentLength);

  // Add headers to each chunk
  const messages = contentChunks.map((chunk, index) => {
    const chunkHeader = index === 0 ? header : continuedHeader;
    return chunkHeader + chunk;
  });

  // Send first chunk (components ride the first chunk only)
  await sendFirst(messages[0], components ?? []);

  // Send remaining chunks as follow-ups — per the delivery contract above,
  // failures past this point stay inside this function.
  for (let i = 1; i < messages.length; i++) {
    try {
      await interaction.followUp({
        content: messages[i],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.warn(
        { err: error, deliveredChunks: i, totalChunks: messages.length },
        'Chunked reply delivery failed part-way'
      );
      await interaction
        .followUp({
          content: '⚠️ Remaining content failed to send — try the view again.',
          flags: MessageFlags.Ephemeral,
        })
        .catch((noticeError: unknown) => {
          // Two consecutive follow-up failures: the warn above is the terminal path
          logger.debug({ err: noticeError }, 'Part-way delivery notice also failed');
        });
      return;
    }
  }
}
