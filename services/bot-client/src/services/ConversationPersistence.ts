/**
 * Conversation Persistence
 *
 * Manages conversation history storage and updates.
 * Handles atomic storage with placeholders and rich description upgrades.
 *
 * STORAGE PHILOSOPHY (2025-12):
 * - `content` field: Plain text only (user message + attachment descriptions)
 * - `messageMetadata` field: Structured data (referenced messages, attachment metadata)
 * - XML formatting happens only at prompt-building time, NOT in storage
 */

import { NO_TEXT_CONTENT_PLACEHOLDER } from '@tzurot/common-types/constants/message';
import { type MessageMetadata } from '@tzurot/common-types/types/schemas/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { Message } from 'discord.js';
import { generateAttachmentPlaceholders } from '../utils/attachmentPlaceholders.js';
import {
  isForwardedMessage,
  resolveForwardedOrigin,
  type ForwardedAuthorPersonalityResolver,
} from '../utils/forwardedMessageUtils.js';
import { buildMessageContent } from '../utils/MessageContentBuilder.js';
import {
  persistAssistantMessageViaGateway,
  patchForwardedOriginViaGateway,
  persistUserMessageViaGateway,
} from '../utils/gatewayWriteHelpers.js';

const logger = createLogger('ConversationPersistence');

/**
 * Options for saving a user message
 */
interface SaveUserMessageOptions {
  /** Discord message */
  message: Message;
  /** Personality being addressed */
  personality: LoadedPersonality;
  /** User's persona ID */
  personaId: string;
  /** Message content (with links replaced) */
  messageContent: string;
  /** Attachments metadata */
  attachments?: {
    url: string;
    contentType: string;
    name?: string;
    size?: number;
    isVoiceMessage?: boolean;
    duration?: number;
    waveform?: string;
  }[];
}

/**
 * Options for saving an assistant message
 */
interface SaveAssistantMessageOptions {
  /** Discord message (for channel/guild context) */
  message: Message;
  /** Personality that responded */
  personality: LoadedPersonality;
  /** User's persona ID */
  personaId: string;
  /** Assistant response content */
  content: string;
  /** Discord message IDs for all chunks */
  chunkMessageIds: string[];
  /** User message timestamp (assistant will be +1ms) */
  userMessageTime: Date;
  /**
   * Reasoning trace from the job result metadata. Persisted onto the history
   * row so it survives the 24h diagnostic window; absent when the model
   * produced none.
   */
  thinkingContent?: string;
}

/**
 * Options for saving a user message from fields (core implementation).
 * Used directly by slash commands, or via saveUserMessage() wrapper for Message objects.
 */
interface SaveUserMessageFromFieldsOptions {
  /** Discord channel ID */
  channelId: string;
  /** Discord guild ID (null for DMs) */
  guildId: string | null;
  /** Discord message ID of the sent user message */
  discordMessageId: string;
  /** Personality being addressed */
  personality: LoadedPersonality;
  /** User's persona ID */
  personaId: string;
  /** Message content (with links replaced) */
  messageContent: string;
  /** Attachments metadata (optional) */
  attachments?: {
    url: string;
    contentType: string;
    name?: string;
    size?: number;
    isVoiceMessage?: boolean;
    duration?: number;
    waveform?: string;
  }[];
  /** Whether this message was forwarded from another channel */
  isForwarded?: boolean;
  /** Embed XML strings for forwarded messages (persisted to survive DB round-trip) */
  embedsXml?: string[];
  /** Explicit timestamp (optional, for ensuring user < assistant ordering) */
  timestamp?: Date;
}

/**
 * Options for saving an assistant message from fields (core implementation).
 * Used directly by slash commands, or via saveAssistantMessage() wrapper for Message objects.
 */
interface SaveAssistantMessageFromFieldsOptions {
  /** Discord channel ID */
  channelId: string;
  /** Discord guild ID (null for DMs) */
  guildId: string | null;
  /** Personality that responded */
  personality: LoadedPersonality;
  /** User's persona ID */
  personaId: string;
  /** Assistant response content */
  content: string;
  /** Discord message IDs for all chunks */
  chunkMessageIds: string[];
  /** User message timestamp (assistant will be +1ms) */
  userMessageTime: Date;
  /** Reasoning trace from the job result metadata; absent when none was produced. */
  thinkingContent?: string;
}

/**
 * Manages conversation history storage and updates
 */
/** Collaborators this service cannot construct for itself. */
export interface ConversationPersistenceDeps {
  /**
   * Maps a forward's original to the internal personality id — parameter
   * semantics on {@link ForwardedAuthorPersonalityResolver}.
   *
   * Injected rather than imported because the mapping needs the personality
   * service, and this class has no other reason to know it exists. Optional so
   * the service stays constructible bare in tests — the only cost of omitting
   * it is a forwarded quote with no `from_id`.
   */
  readonly resolveForwardedAuthorPersonalityId?: ForwardedAuthorPersonalityResolver;
}

export class ConversationPersistence {
  constructor(private readonly deps: ConversationPersistenceDeps = {}) {}

  /**
   * Save user message with placeholder descriptions
   *
   * ARCHITECTURAL DECISION: Atomic storage with placeholders
   * - Saves message BEFORE AI processing
   * - Ensures chronological ordering (user timestamp < assistant timestamp)
   * - Provides immediate placeholder descriptions (not empty data)
   * - Rich descriptions are persisted post-vision by ai-worker (the
   *   descriptions' producer owns the write)
   *
   * STORAGE PHILOSOPHY (2025-12):
   * - `content`: Plain text only (user message + attachment placeholders)
   * - `messageMetadata`: structured data (forwarded flag, embed XML)
   * - Referenced messages are NOT appended to content, and are not written
   *   here at all — ai-worker owns `messageMetadata.referencedMessages`
   */
  async saveUserMessage(options: SaveUserMessageOptions): Promise<void> {
    const { message, personality, personaId, messageContent, attachments } = options;

    const isForwarded = isForwardedMessage(message);

    // Extract embed XML for any message carrying embeds so it survives the DB
    // round-trip. Without this, a message's embeds (forwarded snapshots OR a
    // regular link-embed) are lost once the message ages out of the Discord
    // API fetch window, and the history renders blank. The embed is present at
    // persist time regardless of forwarding, so the gate is purely "has embeds."
    let embedsXml: string[] | undefined;
    if (message.embeds.length > 0) {
      const buildResult = await buildMessageContent(message, {
        includeEmbeds: true,
        includeAttachments: false,
      });
      embedsXml = buildResult.embedsXml;
    }

    // Delegate to field-based implementation with Message fields extracted.
    // Pass `message.createdAt` as the explicit timestamp so the user row's
    // `createdAt` matches the Discord post time. Without this, the row used
    // the DB-default `new Date()` (insert time, hundreds of ms after Discord
    // post), while the corresponding assistant row uses `userMessageTime + 1ms`
    // (Discord post + 1ms) — making the assistant's `createdAt` *earlier* than
    // the user's, and reversing every turn-pair in cross-channel-context output.
    const messageTime = await this.saveUserMessageFromFields({
      channelId: message.channel.id,
      guildId: message.guild?.id ?? null,
      discordMessageId: message.id,
      personality,
      personaId,
      messageContent,
      attachments,
      isForwarded: isForwarded || undefined,
      embedsXml,
      timestamp: message.createdAt,
    });

    // AFTER the row exists, and deliberately not awaited. Recovering a
    // forward's origin costs Discord REST round-trips (the snapshot carries
    // neither author nor id), and this method is awaited before AI job
    // submission — so resolving inline would put that latency in front of
    // every forwarded reply. The trade is that the turn which created the
    // forward may assemble its context before the back-fill lands, so
    // attribution shows up for SUBSEQUENT turns.
    if (isForwarded) {
      void this.backFillForwardedOrigin(message, personality, personaId, messageTime);
    }
  }

  /**
   * Resolve a forward's original author and post time, then attach them to the
   * row that was just written.
   *
   * Never throws and is never awaited: attribution is enrichment, and its
   * worst failure is the unattributed quote that shipped before this existed.
   */
  private async backFillForwardedOrigin(
    message: Message,
    personality: LoadedPersonality,
    personaId: string,
    messageTime: Date
  ): Promise<void> {
    try {
      const forwardedFrom = await resolveForwardedOrigin(
        message,
        this.deps.resolveForwardedAuthorPersonalityId
      );
      if (forwardedFrom === undefined) {
        return;
      }

      await patchForwardedOriginViaGateway({
        channelId: message.channel.id,
        personalityId: personality.id,
        personaId,
        // Handed back BY the persist rather than re-read from the message:
        // the row id derives from it, and the persist applies a `?? new Date()`
        // fallback that `message.createdAt` would not reproduce.
        messageTime,
        forwardedFrom,
      });
    } catch (error) {
      logger.warn(
        { err: error, messageId: message.id },
        'Forwarded-origin back-fill failed; quote stays unattributed'
      );
    }
  }

  /**
   * Save assistant message to conversation history
   *
   * Called AFTER successful Discord send to ensure:
   * - No orphaned assistant messages if Discord send fails
   * - Assistant message has Discord chunk IDs from the start
   * - Proper chronological ordering (user < assistant)
   */
  async saveAssistantMessage(options: SaveAssistantMessageOptions): Promise<void> {
    const {
      message,
      personality,
      personaId,
      content,
      chunkMessageIds,
      userMessageTime,
      thinkingContent,
    } = options;

    // Delegate to field-based implementation with Message fields extracted
    await this.saveAssistantMessageFromFields({
      channelId: message.channel.id,
      guildId: message.guild?.id ?? null,
      personality,
      personaId,
      content,
      chunkMessageIds,
      userMessageTime,
      thinkingContent,
    });
  }

  /**
   * Save user message from fields (core implementation).
   * Called directly by slash commands, or via saveUserMessage() wrapper.
   */
  /**
   * @returns the timestamp the row was actually keyed on. Returned rather than
   * recomputed by callers because the row's deterministic id derives from it,
   * and the `?? new Date()` fallback below means a caller reading
   * `message.createdAt` can arrive at a DIFFERENT value — which addresses a
   * different row and makes any follow-up write silently no-op.
   */
  async saveUserMessageFromFields(options: SaveUserMessageFromFieldsOptions): Promise<Date> {
    const {
      channelId,
      guildId,
      discordMessageId,
      personality,
      personaId,
      messageContent,
      attachments,
      isForwarded,
      embedsXml,
      timestamp,
    } = options;

    // Build content with placeholder descriptions (but NOT references - those go in metadata)
    let userMessageContent = messageContent || NO_TEXT_CONTENT_PLACEHOLDER;

    // Add placeholder attachment descriptions to content
    if (attachments && attachments.length > 0) {
      const attachmentPlaceholders = generateAttachmentPlaceholders(attachments);
      userMessageContent += attachmentPlaceholders;
    }

    // References are NOT written here. The worker owns that field: it is the
    // side that resolves a quote's images and voice notes, and writing the
    // snapshot from here would store one without the enrichment that makes it
    // worth storing.
    let metadata: MessageMetadata | undefined;

    // Persist forwarded flag in metadata for DB round-trip
    if (isForwarded === true) {
      metadata = metadata ?? {};
      metadata.isForwarded = true;
    }

    // Persist embed XML for any embed-bearing message (prevents data loss when
    // messages age out of the Discord API fetch window)
    if (embedsXml !== undefined && embedsXml.length > 0) {
      metadata = metadata ?? {};
      metadata.embedsXml = embedsXml;
    }

    // Use the Discord post time (falling back to now). The deterministic row
    // UUID derives from it, so the value must be stable — a fresh new Date()
    // per write would produce a different id on every retry.
    const effectiveTimestamp = timestamp ?? new Date();
    const writeParams = {
      channelId,
      guildId,
      personalityId: personality.id,
      personaId,
      content: userMessageContent,
      discordMessageId,
      messageMetadata: metadata,
      messageTime: effectiveTimestamp,
    };

    // The gateway endpoint IS the write — synchronous before job submission, so
    // the next message's history query always sees this row. Throws on failure.
    await persistUserMessageViaGateway(writeParams);

    logger.debug(
      {
        channelId,
        hasAttachments: attachments && attachments.length > 0,
        attachmentCount: attachments?.length ?? 0,
        contentLength: userMessageContent.length,
        hasMetadata: metadata !== undefined,
      },
      'Saved user message'
    );

    return effectiveTimestamp;
  }

  /**
   * Save assistant message from fields (core implementation).
   * Called directly by slash commands, or via saveAssistantMessage() wrapper.
   */
  async saveAssistantMessageFromFields(
    options: SaveAssistantMessageFromFieldsOptions
  ): Promise<void> {
    const {
      channelId,
      guildId,
      personality,
      personaId,
      content,
      chunkMessageIds,
      userMessageTime,
      thinkingContent,
    } = options;

    // Invariant: history mirrors what is actually on Discord. Both send paths
    // in DiscordResponseSender throw on failure and push an id per delivered
    // chunk (`sendViaWebhook` via the throwing `sendAsPersonality`,
    // `sendViaDM` via `channel.send`), so zero ids means no message reached
    // Discord and persisting here would fabricate a turn. That makes this a
    // defensive guard rather than a reachable path — pinned by "skips the save
    // when chunkMessageIds is empty" below and by "propagates a webhook send
    // failure instead of returning a short id list" in
    // DiscordResponseSender.test.ts.
    if (chunkMessageIds.length === 0) {
      logger.warn('No chunk message IDs, skipping assistant message save');
      return;
    }

    // Assistant message timestamp: user message + 1ms
    const assistantMessageTime = new Date(userMessageTime.getTime() + 1);

    logger.debug(
      {
        channelId,
        personalityId: personality.id,
        personaId: personaId.substring(0, 8),
        chunkCount: chunkMessageIds.length,
        userMessageTime: userMessageTime.toISOString(),
        assistantMessageTime: assistantMessageTime.toISOString(),
      },
      'Saving assistant message'
    );

    // Both paths send userMessageTime (not assistantMessageTime) to the
    // gateway — it derives the +1ms timestamp itself so the deterministic
    // row id stays a pure function of what it persists.
    const writeParams = {
      channelId,
      guildId,
      personalityId: personality.id,
      personaId,
      content,
      chunkMessageIds,
      userMessageTime,
      thinkingContent,
    };

    // The gateway endpoint IS the write. Throws on failure.
    await persistAssistantMessageViaGateway(writeParams);

    logger.info({ chunks: chunkMessageIds.length }, 'Saved assistant message');
  }
}
