/**
 * Channel Fetcher Types
 *
 * Shared type definitions for Discord channel fetching utilities.
 * Extracted from DiscordChannelFetcher.ts for better modularity and sharing.
 */

import type { TextChannel, DMChannel, NewsChannel, Collection, Message } from 'discord.js';
import type { ConversationMessage, AttachmentMetadata } from '@tzurot/common-types';

/**
 * Guild member info for participant context
 */
export interface ParticipantGuildInfo {
  roles: string[];
  displayColor?: string;
  joinedAt?: string;
}

/**
 * Extended context user info for batch user creation
 */
export interface ExtendedContextUser {
  discordId: string;
  username: string;
  displayName?: string;
  isBot: boolean;
}

/**
 * Result of fetching channel messages
 */
export interface FetchResult {
  /** Messages converted to ConversationMessage format (newest first) */
  messages: ConversationMessage[];
  /** Number of messages fetched from Discord */
  fetchedCount: number;
  /** Number of messages after filtering */
  filteredCount: number;
  /** Raw Discord messages for opportunistic sync (if needed) */
  rawMessages?: Collection<string, Message>;
  /** Image attachments collected from extended context messages (newest first) */
  imageAttachments?: AttachmentMetadata[];
  /** Guild info for participants (keyed by personaId, e.g., 'discord:123456789') */
  participantGuildInfo?: Record<string, ParticipantGuildInfo>;
  /** Unique users from extended context for batch persona creation */
  extendedContextUsers?: ExtendedContextUser[];
  /** Unique users who reacted to messages (for participant persona resolution) */
  reactorUsers?: ExtendedContextUser[];
}

/**
 * Options for fetching channel messages
 */
export interface FetchOptions {
  /** Maximum number of messages to fetch (default: 100) */
  limit?: number;
  /** Message ID to fetch before (excludes this message) */
  before?: string;
  /** Bot's own user ID (to identify assistant messages) */
  botUserId: string;
  /** The personality name (for assistant message attribution) */
  personalityName?: string;
  /** The personality ID (for message tagging) */
  personalityId?: string;
  /** Optional transcript retriever for voice messages */
  getTranscript?: (discordMessageId: string, attachmentUrl: string) => Promise<string | null>;
  /** Whether to resolve Discord message links in history (default: true) */
  resolveLinks?: boolean;
  /** Context epoch - ignore messages before this timestamp (from /history clear) */
  contextEpoch?: Date;
  /** Maximum age in seconds - ignore messages older than this (null = disabled) */
  maxAge?: number | null;
}

/**
 * Channels that support message fetching
 */
export type FetchableChannel = TextChannel | DMChannel | NewsChannel;

/**
 * Result of opportunistic database sync
 */
export interface SyncResult {
  /** Number of messages updated (edits detected) */
  updated: number;
  /** Number of messages soft-deleted (deletes detected) */
  deleted: number;
}
