/**
 * Conversation Input Processor
 *
 * Normalizes incoming conversation inputs for the RAG pipeline:
 * - Attachment processing (vision, transcription)
 * - Message formatting
 * - Reference message handling
 * - Search query construction
 */

import { createLogger, type LoadedPersonality, type MessageContent } from '@tzurot/common-types';
import { processAttachments, type ProcessedAttachment } from './MultimodalProcessor.js';
import { extractRecentHistoryWindow } from './RAGUtils.js';
import type { PromptBuilder } from './PromptBuilder.js';
import type { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import type { ResponsePostProcessor } from './ResponsePostProcessor.js';
import type { ConversationContext, ProcessedInputs } from './ConversationalRAGTypes.js';

const logger = createLogger('ConversationInputProcessor');

/**
 * Processes conversation inputs for the RAG pipeline
 */
export class ConversationInputProcessor {
  constructor(
    private promptBuilder: PromptBuilder,
    private referencedMessageFormatter: ReferencedMessageFormatter,
    private responsePostProcessor: ResponsePostProcessor
  ) {}

  /**
   * Resolve user name from context for placeholder replacement.
   * Priority: userName > activePersonaName > 'User'
   */
  resolveUserName(context: ConversationContext): string {
    if (context.userName !== undefined && context.userName.length > 0) {
      return context.userName;
    }
    if (context.activePersonaName !== undefined && context.activePersonaName.length > 0) {
      return context.activePersonaName;
    }
    return 'User';
  }

  /**
   * Process input attachments and format messages for AI consumption.
   *
   * @param personality - Personality configuration
   * @param message - User's message content
   * @param context - Conversation context
   * @param isGuestMode - Whether user is in guest mode (uses free models)
   * @param userApiKey - User's BYOK API key (for BYOK users)
   */
  async processInputs(
    personality: LoadedPersonality,
    message: MessageContent,
    context: ConversationContext,
    isGuestMode: boolean,
    userApiKey?: string
  ): Promise<ProcessedInputs> {
    // Use pre-processed attachments from dependency jobs if available
    let processedAttachments: ProcessedAttachment[] = [];
    if (context.preprocessedAttachments && context.preprocessedAttachments.length > 0) {
      processedAttachments = context.preprocessedAttachments;
      logger.info(
        { count: processedAttachments.length },
        'Using pre-processed attachments from dependency jobs'
      );
    } else if (context.attachments && context.attachments.length > 0) {
      // Fallback: process attachments inline (shouldn't happen with job chain, but defensive)
      processedAttachments = await processAttachments(
        context.attachments,
        personality,
        isGuestMode,
        userApiKey
      );
      logger.info(
        { count: processedAttachments.length },
        'Processed attachments to text descriptions (inline fallback)'
      );
    }

    // Format the user's message
    const userMessage = this.promptBuilder.formatUserMessage(message, context);

    // Filter out referenced messages that are already in conversation history
    const filteredReferences = this.responsePostProcessor.filterDuplicateReferences(
      context.referencedMessages,
      context.rawConversationHistory
    );

    // Format referenced messages (with vision/transcription)
    const referencedMessagesDescriptions =
      filteredReferences.length > 0
        ? await this.referencedMessageFormatter.formatReferencedMessages(
            filteredReferences,
            personality,
            isGuestMode,
            context.preprocessedReferenceAttachments,
            userApiKey
          )
        : undefined;

    // Extract plain text from formatted references for memory search
    const referencedMessagesTextForSearch =
      referencedMessagesDescriptions !== undefined && referencedMessagesDescriptions.length > 0
        ? this.referencedMessageFormatter.extractTextForSearch(referencedMessagesDescriptions)
        : undefined;

    // Extract recent conversation history for context-aware LTM search
    const recentHistoryWindow = extractRecentHistoryWindow(context.rawConversationHistory);

    // Build search query for memory retrieval
    const searchQuery = this.promptBuilder.buildSearchQuery(
      userMessage,
      processedAttachments,
      referencedMessagesTextForSearch,
      recentHistoryWindow
    );

    return {
      processedAttachments,
      userMessage,
      referencedMessagesDescriptions,
      referencedMessagesTextForSearch,
      searchQuery,
    };
  }
}
