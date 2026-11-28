/**
 * Chunk construction for an edited reply.
 *
 * Mirrors how `DiscordResponseSender` shapes a fresh reply — DM speaker prefix
 * on the text, then the splitter, then the footer on the last chunk — so an
 * edited reply is laid out exactly like an original one.
 */

import { extractMessagePrefixName, splitMessage } from '@tzurot/common-types/utils/discord';
import { appendFooterToChunks } from '../appendFooterToChunks.js';

/** The DM speaker prefix of a live bot message (`**Name:** `), or `''` if it has none. */
export function extractDmPrefix(content: string): string {
  const name = extractMessagePrefixName(content);
  return name === null ? '' : `**${name}:** `;
}

/**
 * Split edited `text` into Discord-sized chunks.
 *
 * @param dmPrefix - speaker prefix to place before the text (DM only; `''` for webhooks)
 * @param footer - trailing footer block, including its leading newline (`''` for none)
 */
export function buildEditedChunks(text: string, dmPrefix: string, footer: string): string[] {
  const chunks = splitMessage(dmPrefix + text);
  appendFooterToChunks(chunks, footer);
  return chunks;
}
