/**
 * Message Context Builder
 *
 * Builds AI context from Discord messages.
 * Handles attachments, references, environment, and conversation history.
 */

import type { Message } from 'discord.js';
import {
  ConversationHistoryService,
  UserService,
  createLogger,
  MessageRole,
  CONTENT_TYPES,
  INTERVALS,
} from '@tzurot/common-types';
import type { LoadedPersonality, ReferencedMessage, ConversationMessage } from '@tzurot/common-types';
import type { MessageContext } from '../types.js';
import { extractDiscordEnvironment } from '../utils/discordContext.js';
import { extractAttachments } from '../utils/attachmentExtractor.js';
import { MessageReferenceExtractor } from '../handlers/MessageReferenceExtractor.js';

const logger = createLogger('MessageContextBuilder');

/**
 * Result of building message context
 */
export interface ContextBuildResult {
  /** Full AI context ready to send to api-gateway */
  context: MessageContext;
  /** User's database UUID */
  userId: string;
  /** Persona ID for this user+personality combination */
  personaId: string;
  /** Persona display name */
  personaName: string | null;
  /** Message content with Discord links replaced by [Reference N] */
  messageContent: string;
  /** Referenced messages (from replies and message links) */
  referencedMessages: ReferencedMessage[];
  /** Conversation history (for reference enrichment) */
  conversationHistory: ConversationMessage[];
}

/**
 * Builds AI context from Discord messages
 */
export class MessageContextBuilder {
  private conversationHistory: ConversationHistoryService;
  private userService: UserService;

  constructor() {
    this.conversationHistory = new ConversationHistoryService();
    this.userService = new UserService();
  }

  /**
   * Build complete AI context from a Discord message
   *
   * Handles:
   * - User/persona lookup
   * - Conversation history retrieval
   * - Reference extraction (with deduplication)
   * - Attachment extraction
   * - Environment context
   */
  async buildContext(
    message: Message,
    personality: LoadedPersonality,
    content: string
  ): Promise<ContextBuildResult> {
    // Get or create user record (needed for conversation history query)
    const displayName =
      message.member?.displayName || message.author.globalName || message.author.username;

    const userId = await this.userService.getOrCreateUser(
      message.author.id,
      message.author.username,
      displayName
    );

    // Get persona for this user + personality combination
    const personaId = await this.userService.getPersonaForUser(userId, personality.id);
    const personaName = await this.userService.getPersonaName(personaId);

    logger.debug(
      {
        personaId,
        personaName,
        userId,
        personalityId: personality.id,
      },
      '[MessageContextBuilder] User persona lookup complete'
    );

    // Get conversation history from PostgreSQL
    // Retrieve more than needed - AI worker will trim based on token budget
    const historyLimit = 100;
    const history = await this.conversationHistory.getRecentHistory(
      message.channel.id,
      personality.id,
      historyLimit
    );

    // Extract Discord message IDs and timestamps for deduplication
    const conversationHistoryMessageIds = history
      .flatMap(msg => msg.discordMessageId || [])
      .filter((id): id is string => id !== undefined && id !== null);

    const conversationHistoryTimestamps = history.map(msg => msg.createdAt);

    // Debug logging for voice message replies
    if (
      message.attachments.some(
        a => a.contentType?.startsWith(CONTENT_TYPES.AUDIO_PREFIX) || a.duration !== null
      )
    ) {
      const mostRecentAssistant = history.filter(m => m.role === MessageRole.Assistant).slice(-1)[0];
      const mostRecentAssistantIds = mostRecentAssistant?.discordMessageId || [];

      logger.debug(
        {
          isReply: message.reference !== null,
          replyToMessageId: message.reference?.messageId,
          messageContent: content || '(empty - voice only)',
          historyCount: history.length,
          replyMatchesRecentAssistant: mostRecentAssistantIds.includes(
            message.reference?.messageId || ''
          ),
        },
        '[MessageContextBuilder] Processing voice message reply - deduplication data'
      );
    }

    // Extract referenced messages (from replies and message links)
    // Uses conversation history for deduplication
    logger.debug('[MessageContextBuilder] Extracting referenced messages with deduplication');
    const referenceExtractor = new MessageReferenceExtractor({
      maxReferences: 10,
      embedProcessingDelayMs: INTERVALS.EMBED_PROCESSING_DELAY,
      conversationHistoryMessageIds,
      conversationHistoryTimestamps,
    });

    const { references: referencedMessages, updatedContent } =
      await referenceExtractor.extractReferencesWithReplacement(message);

    // Log reference extraction results
    if (referencedMessages.length > 0) {
      logger.info(
        {
          count: referencedMessages.length,
          referenceNumbers: referencedMessages.map(r => r.referenceNumber),
        },
        '[MessageContextBuilder] Extracted referenced messages (after deduplication)'
      );
    }

    // Use updatedContent (with Discord links replaced by [Reference N])
    const messageContent = updatedContent ?? content ?? '[no text content]';

    // Convert conversation history to API format
    const conversationHistory = history.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
      personaId: msg.personaId,
      personaName: msg.personaName,
    }));

    // Extract attachments (images, audio, etc)
    const attachments = extractAttachments(message.attachments);

    // Extract Discord environment context
    const environment = extractDiscordEnvironment(message);

    // Build complete context
    const context: MessageContext = {
      userId,
      userName: message.author.username,
      channelId: message.channel.id,
      serverId: message.guild?.id,
      messageContent,
      activePersonaId: personaId,
      activePersonaName: personaName || undefined,
      conversationHistory,
      attachments,
      environment,
      referencedMessages: referencedMessages.length > 0 ? referencedMessages : undefined,
    };

    logger.debug(
      {
        activePersonaId: context.activePersonaId,
        activePersonaName: context.activePersonaName,
        historyLength: conversationHistory.length,
        referencedMessagesCount: referencedMessages.length,
      },
      '[MessageContextBuilder] Context built successfully'
    );

    return {
      context,
      userId,
      personaId,
      personaName,
      messageContent,
      referencedMessages,
      conversationHistory: history, // Return for reference enrichment
    };
  }
}
