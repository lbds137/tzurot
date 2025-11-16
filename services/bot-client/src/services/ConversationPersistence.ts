/**
 * Conversation Persistence
 *
 * Manages conversation history storage and updates.
 * Handles atomic storage with placeholders and rich description upgrades.
 */

import type { Message } from 'discord.js';
import { ConversationHistoryService, createLogger, MessageRole } from '@tzurot/common-types';
import type { LoadedPersonality, ReferencedMessage } from '@tzurot/common-types';
import { generateAttachmentPlaceholders } from '../utils/attachmentPlaceholders.js';
import { formatReferencesForDatabase } from '../utils/referenceFormatter.js';

const logger = createLogger('ConversationPersistence');

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
 * Manages conversation history storage and updates
 */
export class ConversationPersistence {
  private conversationHistory: ConversationHistoryService;

  constructor() {
    this.conversationHistory = new ConversationHistoryService();
  }

  /**
   * Save user message with placeholder descriptions
   *
   * ARCHITECTURAL DECISION: Atomic storage with placeholders
   * - Saves message BEFORE AI processing
   * - Ensures chronological ordering (user timestamp < assistant timestamp)
   * - Provides immediate placeholder descriptions (not empty data)
   * - Rich descriptions added later via updateUserMessage()
   */
  async saveUserMessage(options: SaveUserMessageOptions): Promise<void> {
    const { message, personality, personaId, messageContent, attachments, referencedMessages } =
      options;

    // Build content with placeholder descriptions
    let userMessageContent = messageContent || '[no text content]';

    // Add placeholder attachment descriptions
    if (attachments && attachments.length > 0) {
      const attachmentPlaceholders = generateAttachmentPlaceholders(attachments);
      userMessageContent += attachmentPlaceholders;
    }

    // Add placeholder reference descriptions
    if (referencedMessages && referencedMessages.length > 0) {
      const referencePlaceholders = formatReferencesForDatabase(referencedMessages);
      userMessageContent += referencePlaceholders;
    }

    // Save atomically with all placeholder descriptions
    await this.conversationHistory.addMessage(
      message.channel.id,
      personality.id,
      personaId,
      MessageRole.User,
      userMessageContent,
      message.guild?.id || null,
      message.id // Discord message ID for deduplication
    );

    logger.debug(
      {
        hasAttachments: attachments && attachments.length > 0,
        attachmentCount: attachments?.length || 0,
        hasReferences: referencedMessages && referencedMessages.length > 0,
        referenceCount: referencedMessages?.length || 0,
        contentLength: userMessageContent.length,
      },
      '[ConversationPersistence] Saved user message with placeholder descriptions'
    );
  }

  /**
   * Upgrade user message from placeholders to rich descriptions
   *
   * Called after AI processing completes with vision/transcription results.
   * If AI processing failed, placeholders remain (acceptable degradation).
   */
  async updateUserMessage(
    message: Message,
    personality: LoadedPersonality,
    personaId: string,
    messageContent: string,
    attachmentDescriptions?: string,
    referencedMessagesDescriptions?: string
  ): Promise<void> {
    if (!attachmentDescriptions && !referencedMessagesDescriptions) {
      logger.debug(
        '[ConversationPersistence] No rich descriptions available, keeping placeholders'
      );
      return;
    }

    let enrichedContent = messageContent;

    // Upgrade attachment placeholders to rich descriptions
    if (attachmentDescriptions) {
      enrichedContent = enrichedContent
        ? `${enrichedContent}\n\n${attachmentDescriptions}`
        : attachmentDescriptions;

      logger.debug(
        { descriptionLength: attachmentDescriptions.length },
        '[ConversationPersistence] Upgrading attachment placeholders to rich descriptions'
      );
    }

    // Upgrade reference placeholders to rich descriptions
    if (referencedMessagesDescriptions) {
      enrichedContent += `\n\n${referencedMessagesDescriptions}`;

      logger.debug(
        { descriptionLength: referencedMessagesDescriptions.length },
        '[ConversationPersistence] Upgrading reference placeholders to rich descriptions'
      );
    }

    // Update the message we saved earlier
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

    if (chunkMessageIds.length === 0) {
      logger.warn({}, '[ConversationPersistence] No chunk message IDs, skipping assistant message save');
      return;
    }

    // Assistant message timestamp: user message + 1ms
    const assistantMessageTime = new Date(userMessageTime.getTime() + 1);

    logger.debug(
      {
        channelId: message.channel.id,
        isThread: message.channel.isThread(),
        personalityId: personality.id,
        personaId: personaId.substring(0, 8),
        chunkCount: chunkMessageIds.length,
        discordMessageIds: chunkMessageIds,
        userMessageTime: userMessageTime.toISOString(),
        assistantMessageTime: assistantMessageTime.toISOString(),
      },
      '[ConversationPersistence] Creating assistant message with Discord chunk IDs'
    );

    await this.conversationHistory.addMessage(
      message.channel.id,
      personality.id,
      personaId,
      MessageRole.Assistant,
      content, // Clean content without model indicator
      message.guild?.id || null,
      chunkMessageIds, // Array of Discord message IDs
      assistantMessageTime // Explicit timestamp for chronological ordering
    );

    logger.info(
      { chunks: chunkMessageIds.length },
      '[ConversationPersistence] Saved assistant message to history'
    );
  }
}
