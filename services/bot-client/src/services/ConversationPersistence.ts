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

import type { PrismaClient } from '@tzurot/common-types';
import type { Message } from 'discord.js';
import { ConversationHistoryService, createLogger, MessageRole } from '@tzurot/common-types';
import type {
  LoadedPersonality,
  ReferencedMessage,
  MessageMetadata,
  StoredReferencedMessage,
} from '@tzurot/common-types';
import { generateAttachmentPlaceholders } from '../utils/attachmentPlaceholders.js';

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
  }));
}

/**
 * Options for saving a user message
 */
export interface SaveUserMessageOptions {
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
export interface SaveAssistantMessageOptions {
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
 * Options for updating a user message with rich descriptions
 */
export interface UpdateUserMessageOptions {
  /** Discord message */
  message: Message;
  /** Personality being addressed */
  personality: LoadedPersonality;
  /** User's persona ID */
  personaId: string;
  /** Original message content */
  messageContent: string;
  /** Rich attachment descriptions from AI processing */
  attachmentDescriptions?: string;
}

/**
 * Options for saving a user message from fields (core implementation).
 * Used directly by slash commands, or via saveUserMessage() wrapper for Message objects.
 */
export interface SaveUserMessageFromFieldsOptions {
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
}

/**
 * Options for saving an assistant message from fields (core implementation).
 * Used directly by slash commands, or via saveAssistantMessage() wrapper for Message objects.
 */
export interface SaveAssistantMessageFromFieldsOptions {
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
  private conversationHistory: ConversationHistoryService;

  constructor(prisma: PrismaClient) {
    this.conversationHistory = new ConversationHistoryService(prisma);
  }

  /**
   * Save user message with placeholder descriptions
   *
   * ARCHITECTURAL DECISION: Atomic storage with placeholders
   * - Saves message BEFORE AI processing
   * - Ensures chronological ordering (user timestamp < assistant timestamp)
   * - Provides immediate placeholder descriptions (not empty data)
   * - Rich descriptions added later via updateUserMessage()
   *
   * STORAGE PHILOSOPHY (2025-12):
   * - `content`: Plain text only (user message + attachment placeholders)
   * - `messageMetadata.referencedMessages`: Structured snapshot of referenced messages
   * - Referenced messages are NOT appended to content anymore
   */
  async saveUserMessage(options: SaveUserMessageOptions): Promise<void> {
    const { message, personality, personaId, messageContent, attachments, referencedMessages } =
      options;

    // Delegate to field-based implementation with Message fields extracted
    await this.saveUserMessageFromFields({
      channelId: message.channel.id,
      guildId: message.guild?.id ?? null,
      discordMessageId: message.id,
      personality,
      personaId,
      messageContent,
      attachments,
      referencedMessages,
    });
  }

  /**
   * Upgrade user message from placeholders to rich descriptions
   *
   * Called after AI processing completes with vision/transcription results.
   * If AI processing failed, placeholders remain (acceptable degradation).
   *
   * STORAGE PHILOSOPHY (2025-12):
   * - Only attachment descriptions go in `content` (user message + attachments)
   * - Referenced messages are already in `messageMetadata` (from saveUserMessage)
   * - Referenced message descriptions are NOT stored - they're formatted at prompt time
   */
  async updateUserMessage(options: UpdateUserMessageOptions): Promise<void> {
    const { message, personality, personaId, messageContent, attachmentDescriptions } = options;

    // Only update if we have attachment descriptions
    // Referenced messages are already in metadata, not content
    if (
      attachmentDescriptions === undefined ||
      attachmentDescriptions === null ||
      attachmentDescriptions.length === 0
    ) {
      logger.debug(
        '[ConversationPersistence] No attachment descriptions available, keeping placeholders'
      );
      return;
    }

    // Upgrade attachment placeholders to rich descriptions (but NOT references)
    const enrichedContent = messageContent
      ? `${messageContent}\n\n${attachmentDescriptions}`
      : attachmentDescriptions;

    logger.debug(
      { descriptionLength: attachmentDescriptions.length },
      '[ConversationPersistence] Upgrading attachment placeholders to rich descriptions'
    );

    // Update the message content only (metadata with references is already saved)
    await this.conversationHistory.updateLastUserMessage(
      message.channel.id,
      personality.id,
      personaId,
      enrichedContent
    );
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
    } = options;

    // Build content with placeholder descriptions (but NOT references - those go in metadata)
    let userMessageContent = messageContent || '[no text content]';

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

    // Save atomically with placeholder descriptions and structured metadata
    await this.conversationHistory.addMessage({
      channelId,
      personalityId: personality.id,
      personaId,
      role: MessageRole.User,
      content: userMessageContent,
      guildId,
      discordMessageId,
      messageMetadata: metadata,
    });

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
      '[ConversationPersistence] Saved user message'
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
      logger.warn(
        {},
        '[ConversationPersistence] No chunk message IDs, skipping assistant message save'
      );
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
      '[ConversationPersistence] Saving assistant message'
    );

    await this.conversationHistory.addMessage({
      channelId,
      personalityId: personality.id,
      personaId,
      role: MessageRole.Assistant,
      content,
      guildId,
      discordMessageId: chunkMessageIds,
      timestamp: assistantMessageTime,
    });

    logger.info(
      { chunks: chunkMessageIds.length },
      '[ConversationPersistence] Saved assistant message'
    );
  }
}
