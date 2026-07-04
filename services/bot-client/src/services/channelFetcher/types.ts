/**
 * Channel Fetcher Types
 *
 * Shared type definitions for Discord channel fetching utilities.
 * Extracted from DiscordChannelFetcher.ts for better modularity and sharing.
 */

import type { TextChannel, DMChannel, NewsChannel, Collection, Message } from 'discord.js';
import type { ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import type {
  AttachmentMetadata,
  GuildMemberInfo,
} from '@tzurot/common-types/types/schemas/discord';

/**
 * Guild member info for participant context.
 *
 * Re-exported alias of the canonical `GuildMemberInfo` (common-types). Kept as
 * a named export so existing channel-fetcher imports don't churn, but it is no
 * longer an independent structural definition — there's one source of truth.
 */
export type ParticipantGuildInfo = GuildMemberInfo;

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
  /** Image attachments collected from extended context messages, in collection
   * order (OLDEST-first — only the `messages` array is reversed to newest-first).
   * The worker caps with slice(-maxImages) to keep the newest. */
  imageAttachments?: AttachmentMetadata[];
  /**
   * Voice attachments from extended-context messages whose transcript the bot
   * could NOT resolve at fetch time (cache miss + no bot-reply in window). The
   * worker re-resolves these (DB-first, STT-fallback). Each carries
   * `sourceDiscordMessageId` so the worker can match it to its message. Same
   * OLDEST-first collection order as imageAttachments (worker takes the newest tail).
   */
  voiceAttachments?: AttachmentMetadata[];
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
  /**
   * Canonical bot suffix (e.g. ` · Tzurot`) derived from the bot's Discord
   * tag via `deriveBotSuffix`. Used to strip the suffix off webhook usernames
   * when extracting personality display names. Optional for backward
   * compatibility: callers that don't supply it get the raw webhook username
   * as the personality name attribution.
   */
  botSuffix?: string;
  /** The personality name (for assistant message attribution) */
  personalityName?: string;
  /** The personality ID (for message tagging) */
  personalityId?: string;
  /** Optional transcript retriever for voice messages */
  getTranscript?: (discordMessageId: string, attachmentUrl: string) => Promise<string | null>;
  /**
   * Optional resolver for "is this message one of OUR personality messages, and
   * which personality?" — the authoritative our-webhook registry
   * (`redisService.getWebhookPersonality`), returning the personality UUID or
   * `null`. Used to classify message role/identity in `convertMessage`:
   *  - A guild webhook message in the registry → our character reply (assistant).
   *  - A primary-bot message in the registry → our DM personality response
   *    (assistant; webhooks don't work in DMs).
   *  - A primary-bot message NOT in the registry → a relay-echo / transcript of
   *    USER content (`channel.send("**Name:** …")`), which is user-role content.
   * Dual-detection: registry primary, `webhookId` + bot-suffix as fallback.
   * Optional, but the
   * fallback only covers GUILD webhooks (bot-suffix on the webhook username): if
   * this is omitted, primary-bot DM personality responses (no `webhookId`, no
   * suffix) are misclassified as relay-echoes (user role). Production always
   * wires it; the option exists for tests that classify by suffix or never
   * exercise primary-bot DM messages.
   */
  getOurPersonalityId?: (messageId: string) => Promise<string | null>;
  /** Whether to resolve Discord message links in history (default: true) */
  resolveLinks?: boolean;
  /** Context epoch - ignore messages before this timestamp (from /history clear) */
  contextEpoch?: Date;
  /** Maximum age in seconds - ignore messages older than this (null = disabled) */
  maxAge?: number | null;
  /** Optional callback to check if a user is BLOCK-denied (filters their messages from context) */
  isBlockDenied?: (discordUserId: string) => boolean;
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
