/**
 * Conversation Types
 *
 * Shared type definitions for conversation processing utilities.
 * Extracted from conversationUtils.ts for better modularity and sharing.
 */

import type { MessageRole, StoredReferencedMessage, MessageReaction } from '@tzurot/common-types';

/**
 * Image description for inline display in chat_log
 */
export interface InlineImageDescription {
  filename: string;
  description: string;
}

/**
 * Raw conversation history entry (before BaseMessage conversion)
 */
export interface RawHistoryEntry {
  /** Internal message ID (database UUID) */
  id?: string;
  /**
   * Discord message IDs (snowflakes) for this message.
   * Array because long messages may be split into multiple Discord messages (chunks).
   * Used for quote deduplication: if a referenced message's Discord ID is in history,
   * we don't need to repeat it in quoted_messages.
   */
  discordMessageId?: string[];
  role: MessageRole | string;
  content: string;
  createdAt?: string;
  /** User's persona ID */
  personaId?: string;
  /** User's persona display name */
  personaName?: string;
  /** Discord username for disambiguation when persona name matches personality name */
  discordUsername?: string;
  tokenCount?: number;
  /** Whether this message was forwarded from another channel */
  isForwarded?: boolean;
  /** Structured metadata (referenced messages, attachments) - formatted at prompt time */
  messageMetadata?: {
    referencedMessages?: StoredReferencedMessage[];
    /** Image descriptions from extended context preprocessing */
    imageDescriptions?: InlineImageDescription[];
    /** Embed XML strings for extended context messages (already formatted by EmbedParser) */
    embedsXml?: string[];
    /** Voice transcripts for extended context messages */
    voiceTranscripts?: string[];
    /** Forwarded image attachment descriptors (fallback when vision isn't available) */
    forwardedAttachmentLines?: string[];
    /** Reactions on this message (emoji + who reacted) */
    reactions?: MessageReaction[];
  };
  // AI personality info (for multi-AI channel attribution)
  /** The AI personality ID this message belongs to */
  personalityId?: string;
  /** The AI personality's display name (for assistant message attribution) */
  personalityName?: string;
}
