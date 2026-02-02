/**
 * Message Type Filters
 *
 * Filter functions for Discord message types that should be excluded from extended context.
 * Extracted from DiscordChannelFetcher.ts for better modularity.
 */

import type { Message } from 'discord.js';

/**
 * Check if a message is a thinking block output
 *
 * Thinking blocks are reasoning/chain-of-thought outputs sent as separate messages
 * before the actual response. They're sent via webhook and identified by:
 * 1. Starting with the thinking block header "💭 **Thinking:**"
 *
 * We filter these out because:
 * - They're meant for user visibility only (displayed in Discord spoilers)
 * - Including them would pollute context and waste tokens
 * - The actual response (without thinking) is what should be in context
 */
export function isThinkingBlockMessage(msg: Message): boolean {
  return msg.content.startsWith('💭 **Thinking:**');
}

/**
 * Check if a message is a bot transcript reply to a voice message
 *
 * Bot transcript replies are messages the bot sends after transcribing a voice message.
 * They're identified by:
 * 1. Being from the bot
 * 2. Being a reply to another message (the voice message)
 * 3. Having text content (the transcript)
 *
 * We filter these out because:
 * - Transcripts are stored in DB and retrieved via TranscriptRetriever
 * - Including them would duplicate content in extended context
 */
export function isBotTranscriptReply(msg: Message, botUserId: string): boolean {
  // Must be from the bot
  if (msg.author.id !== botUserId) {
    return false;
  }

  // Must be a reply to another message
  if (msg.reference?.messageId === undefined) {
    return false;
  }

  // Must have text content (the transcript text)
  if (msg.content.length === 0) {
    return false;
  }

  return true;
}
