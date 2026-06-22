/**
 * Conversation message data shapes.
 *
 * These are pure domain shapes consumed across services (bot-client's
 * DiscordChannelFetcher, ai-worker context assembly, and common-types' own
 * history/cross-channel utils), so they live in the shared type package while
 * the Prisma-backed mapping logic that PRODUCES them lives in
 * `@tzurot/conversation-history` (`ConversationMessageMapper`).
 */

import type { MessageRole } from '../constants/index.js';
import type { MessageMetadata } from './schemas/index.js';

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  tokenCount?: number; // Cached token count (computed once, reused on every request)
  createdAt: Date;
  personaId: string;
  personaName?: string; // The user's persona name for display in context
  discordUsername?: string; // Discord username for disambiguation when persona name matches personality name
  discordMessageId: string[]; // Discord snowflake IDs for chunked messages (deduplication)
  isForwarded?: boolean; // Whether this message was forwarded from another channel
  messageMetadata?: MessageMetadata; // Structured metadata (referenced messages, attachments)
  // AI personality info (for multi-AI channel attribution)
  personalityId?: string; // The AI personality this message belongs to
  personalityName?: string; // The AI personality's display name (for assistant messages)
  // Channel info (always populated — used for cross-channel history grouping)
  channelId: string; // Discord channel ID
  guildId: string | null; // Discord guild ID (null for DMs)
}

/**
 * A group of messages from a single channel, used for cross-channel history results.
 * Groups are ordered by most recent activity (most recent channel first).
 * Messages within each group are in chronological order (oldest first).
 */
export interface CrossChannelHistoryGroup {
  channelId: string;
  guildId: string | null;
  messages: ConversationMessage[];
}
