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
import {
  type ReferencedMessage,
  type MessageMetadata,
  type StoredReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { Message } from 'discord.js';
import { generateAttachmentPlaceholders } from '../utils/attachmentPlaceholders.js';
import { isForwardedMessage } from '../utils/forwardedMessageUtils.js';
import { buildMessageContent } from '../utils/MessageContentBuilder.js';
import {
  persistAssistantMessageViaGateway,
  persistUserMessageViaGateway,
} from '../utils/gatewayWriteHelpers.js';

const logger = createLogger('ConversationPersistence');

/**
 * Convert ReferencedMessage (from request) to StoredReferencedMessage (for database)
 * This creates a snapshot of the referenced message at the time it was referenced.
 */
function convertToStoredReferences(references: ReferencedMessage[]): StoredReferencedMessage[] {
  return references.map(ref => ({
    discordMessageId: ref.discordMessageId,
    authorUsername: ref.authorUsername,
    authorDisplayName: ref.authorDisplayName,
    content: ref.content,
    embeds: ref.embeds || undefined,
    timestamp: ref.timestamp,
    locationContext: ref.locationContext,
    attachments: ref.attachments,
    isForwarded: ref.isForwarded,
    // Carry the classification forward so the stored-history quote renders the same
    // role as the live one (classify-once in MessageFormatter, render in the worker).
    authorRole: ref.authorRole,
  }));
}

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
  /** Referenced messages */
  referencedMessages?: ReferencedMessage[];
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
  /** Referenced messages (optional) */
  referencedMessages?: ReferencedMessage[];
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
}

/**
 * Manages conversation history storage and updates
 */
export class ConversationPersistence {
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
   * - `messageMetadata.referencedMessages`: Structured snapshot of referenced messages
   * - Referenced messages are NOT appended to content anymore
   */
  async saveUserMessage(options: SaveUserMessageOptions): Promise<void> {
    const { message, personality, personaId, messageContent, attachments, referencedMessages } =
      options;

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
    await this.saveUserMessageFromFields({
      channelId: message.channel.id,
      guildId: message.guild?.id ?? null,
      discordMessageId: message.id,
      personality,
      personaId,
      messageContent,
      attachments,
      referencedMessages,
      isForwarded: isForwarded || undefined,
      embedsXml,
      timestamp: message.createdAt,
    });
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
    const { message, personality, personaId, content, chunkMessageIds, userMessageTime } = options;

    // Delegate to field-based implementation with Message fields extracted
    await this.saveAssistantMessageFromFields({
      channelId: message.channel.id,
      guildId: message.guild?.id ?? null,
      personality,
      personaId,
      content,
      chunkMessageIds,
      userMessageTime,
    });
  }

  /**
   * Save user message from fields (core implementation).
   * Called directly by slash commands, or via saveUserMessage() wrapper.
   */
  async saveUserMessageFromFields(options: SaveUserMessageFromFieldsOptions): Promise<void> {
    const {
      channelId,
      guildId,
      discordMessageId,
      personality,
      personaId,
      messageContent,
      attachments,
      referencedMessages,
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

    // Build message metadata with referenced messages (stored structurally, not as text)
    let metadata: MessageMetadata | undefined;
    if (referencedMessages && referencedMessages.length > 0) {
      metadata = {
        referencedMessages: convertToStoredReferences(referencedMessages),
      };
    }

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
        hasReferences: referencedMessages && referencedMessages.length > 0,
        referenceCount: referencedMessages?.length ?? 0,
        contentLength: userMessageContent.length,
        hasMetadata: metadata !== undefined,
      },
      'Saved user message'
    );
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
    } = options;

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
    };

    // The gateway endpoint IS the write. Throws on failure.
    await persistAssistantMessageViaGateway(writeParams);

    logger.info({ chunks: chunkMessageIds.length }, 'Saved assistant message');
  }
}
