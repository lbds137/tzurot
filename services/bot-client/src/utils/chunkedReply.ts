/**
 * Chunked ephemeral reply utility.
 *
 * Splits long content into Discord-safe chunks with headers,
 * sending the first as an editReply and the rest as follow-ups.
 */

import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import { DISCORD_LIMITS, splitMessage } from '@tzurot/common-types';

export interface ChunkedReplyOptions {
  interaction: ButtonInteraction;
  content: string;
  header: string;
  continuedHeader: string;
}

/**
 * Send content as ephemeral chunked replies with headers.
 *
 * If the content fits in one message, sends a single editReply.
 * Otherwise, splits the content using paragraph-aware chunking
 * and sends the first chunk as editReply, the rest as follow-ups.
 */
export async function sendChunkedReply(options: ChunkedReplyOptions): Promise<void> {
  const { interaction, content, header, continuedHeader } = options;

  // Use the longer header length to ensure all chunks fit
  const maxHeaderLength = Math.max(header.length, continuedHeader.length);
  const maxContentLength = DISCORD_LIMITS.MESSAGE_LENGTH - maxHeaderLength;

  if (content.length <= maxContentLength) {
    await interaction.editReply(`${header}${content}`);
    return;
  }

  // Use smart chunking that preserves paragraphs, sentences, and code blocks
  const contentChunks = splitMessage(content, maxContentLength);

  // Add headers to each chunk
  const messages = contentChunks.map((chunk, index) => {
    const chunkHeader = index === 0 ? header : continuedHeader;
    return chunkHeader + chunk;
  });

  // Send first chunk as reply
  await interaction.editReply(messages[0]);

  // Send remaining chunks as follow-ups
  for (let i = 1; i < messages.length; i++) {
    await interaction.followUp({
      content: messages[i],
      flags: MessageFlags.Ephemeral,
    });
  }
}
