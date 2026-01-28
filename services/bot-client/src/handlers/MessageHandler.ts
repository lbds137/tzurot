/**
 * Message Handler
 *
 * Coordinates message processing using Chain of Responsibility pattern.
 * Each processor in the chain handles a specific type of message.
 * Implements full dependency injection for testability and flexibility.
 */

import { MessageType, type Message } from 'discord.js';
import {
  createLogger,
  type LLMGenerationResult,
  formatPersonalityErrorMessage,
  stripErrorSpoiler,
  USER_ERROR_MESSAGES,
} from '@tzurot/common-types';
import type { IMessageProcessor } from '../processors/IMessageProcessor.js';
import { isUserContentMessage } from '../utils/messageTypeUtils.js';
import { DiscordResponseSender } from '../services/DiscordResponseSender.js';
import { ConversationPersistence } from '../services/ConversationPersistence.js';
import { JobTracker, type PendingJobContext } from '../services/JobTracker.js';

const logger = createLogger('MessageHandler');

/**
 * Message Handler - routes Discord messages using Chain of Responsibility
 */
export class MessageHandler {
  constructor(
    private readonly processors: IMessageProcessor[],
    private readonly responseSender: DiscordResponseSender,
    private readonly persistence: ConversationPersistence,
    private readonly jobTracker: JobTracker
  ) {
    logger.info(
      { processorCount: processors.length },
      '[MessageHandler] Initialized with processor chain'
    );
  }

  /**
   * Handle incoming Discord message
   * Passes message through processor chain until one handles it
   */
  async handleMessage(message: Message): Promise<void> {
    try {
      // Skip system messages (thread creation, pinned messages, user joins, etc.)
      // Only process user-generated content (Default, Reply, Forward)
      if (!isUserContentMessage(message)) {
        logger.debug(
          {
            messageId: message.id,
            messageType: message.type,
            messageTypeName: MessageType[message.type],
          },
          '[MessageHandler] Ignoring system message'
        );
        return;
      }

      logger.debug(
        { messageId: message.id, authorTag: message.author.tag },
        '[MessageHandler] Processing message'
      );

      // Pass message through the chain of processors
      for (const processor of this.processors) {
        const wasHandled = await processor.process(message);

        if (wasHandled) {
          logger.debug(
            { messageId: message.id, processorName: processor.constructor.name },
            '[MessageHandler] Message handled by processor'
          );
          return; // Stop the chain
        }
      }

      // No processor handled the message
      logger.debug(
        { messageId: message.id },
        '[MessageHandler] Message not handled by any processor'
      );
    } catch (error) {
      logger.error({ err: error }, '[MessageHandler] Error processing message');

      // Try to send error message to user
      await message
        .reply('Sorry, I encountered an error processing your message.')
        .catch(replyError => {
          logger.warn(
            { err: replyError, messageId: message.id },
            '[MessageHandler] Failed to send error message to user'
          );
        });
    }
  }

  /**
   * Handle async job result when it arrives from ResultsListener
   * This is called from index.ts result handler
   */

  async handleJobResult(jobId: string, result: LLMGenerationResult): Promise<void> {
    // Get pending job context from JobTracker
    const jobContext = this.jobTracker.getContext(jobId);
    if (!jobContext) {
      logger.warn({ jobId }, '[MessageHandler] Received result for unknown job - ignoring');
      return;
    }

    // Complete the job (clears typing indicator and removes from tracker)
    this.jobTracker.completeJob(jobId);

    const { message, personality, personaId, userMessageContent, userMessageTime, isAutoResponse } =
      jobContext;

    // Handle explicit failure from ai-worker (success: false)
    if (result.success === false) {
      logger.error(
        { jobId, error: result.error, errorInfo: result.errorInfo },
        '[MessageHandler] Job failed with error from ai-worker'
      );
      await this.sendErrorResponse(jobId, this.buildErrorContent(result), result, jobContext);
      return;
    }

    // BOUNDARY VALIDATION: Validate result has valid content before using it
    if (
      result.content === undefined ||
      result.content === null ||
      result.content.length === 0 ||
      typeof result.content !== 'string'
    ) {
      logger.error(
        {
          jobId,
          hasContent: result.content !== undefined && result.content !== null,
          contentType: typeof result.content,
        },
        '[MessageHandler] Job result missing or invalid content field'
      );
      await this.sendErrorResponse(jobId, this.buildErrorContent(result), result, jobContext);
      return;
    }

    try {
      // Upgrade user message from placeholders to rich descriptions
      await this.persistence.updateUserMessage({
        message,
        personality,
        personaId,
        messageContent: userMessageContent,
        attachmentDescriptions: result.attachmentDescriptions,
      });

      // Send AI response to Discord
      const { chunkMessageIds } = await this.responseSender.sendResponse({
        content: result.content,
        personality,
        message,
        modelUsed: result.metadata?.modelUsed,
        isGuestMode: result.metadata?.isGuestMode,
        isAutoResponse,
        focusModeEnabled: result.metadata?.focusModeEnabled,
        incognitoModeActive: result.metadata?.incognitoModeActive,
        thinkingContent: result.metadata?.thinkingContent,
      });

      // Save assistant message to conversation history
      await this.persistence.saveAssistantMessage({
        message,
        personality,
        personaId,
        content: result.content,
        chunkMessageIds,
        userMessageTime,
      });

      logger.info(
        { jobId, chunks: chunkMessageIds.length },
        '[MessageHandler] Async job result delivered successfully'
      );
    } catch (error) {
      logger.error({ err: error, jobId }, '[MessageHandler] Error handling job result');
      // Try to notify user of the error via webhook (don't throw - we don't want to crash the listener)
      await this.sendErrorResponse(jobId, this.buildErrorContent(result), result, jobContext);
    }
  }

  /**
   * Send error response to Discord and save to history
   * Extracted to reduce complexity in handleJobResult
   */
  private async sendErrorResponse(
    jobId: string,
    errorContent: string,
    result: LLMGenerationResult,
    jobContext: PendingJobContext
  ): Promise<void> {
    const { message, personality, personaId, userMessageTime, isAutoResponse } = jobContext;

    try {
      const { chunkMessageIds } = await this.responseSender.sendResponse({
        content: errorContent,
        personality,
        message,
        modelUsed: result.metadata?.modelUsed,
        isGuestMode: result.metadata?.isGuestMode,
        isAutoResponse,
        focusModeEnabled: result.metadata?.focusModeEnabled,
        incognitoModeActive: result.metadata?.incognitoModeActive,
      });

      // Save error message to history (stripped of technical spoiler details)
      await this.persistence.saveAssistantMessage({
        message,
        personality,
        personaId,
        content: stripErrorSpoiler(errorContent),
        chunkMessageIds,
        userMessageTime,
      });
    } catch (sendError) {
      logger.error(
        { err: sendError, jobId },
        '[MessageHandler] Failed to send error via webhook, falling back to reply'
      );
      // Fallback to direct reply if webhook fails
      await message.reply(errorContent).catch(() => {
        // Intentionally ignore reply failures - we've already logged the webhook error
      });
    }
  }

  /**
   * Build error content for user display
   *
   * If the result has structured error info and a personality error message,
   * formats the message to include error details in Discord spoiler tags.
   * This allows users to see what went wrong while keeping the error message
   * in the personality's voice.
   *
   * Example with placeholder:
   *   Input: "Oops! Something went wrong ||*(an error has occurred)*||"
   *   Output: "Oops! Something went wrong ||*(quota exceeded; ref: m5abc123)*||"
   *
   * Example without placeholder:
   *   Input: "I'm having trouble thinking right now..."
   *   Output: "I'm having trouble thinking right now... ||*(quota exceeded; ref: m5abc123)*||"
   */
  private buildErrorContent(result: LLMGenerationResult): string {
    const DEFAULT_ERROR =
      'Sorry, I encountered an error generating a response. Please try again later.';

    // If we have structured error info, use it for dynamic messaging
    if (result.errorInfo) {
      const { category, referenceId } = result.errorInfo;

      // If personality has a custom error message, format it with error details
      if (result.personalityErrorMessage !== undefined && result.personalityErrorMessage !== '') {
        return formatPersonalityErrorMessage(result.personalityErrorMessage, category, referenceId);
      }

      // No personality message - use the category-specific user message
      const userMessage = USER_ERROR_MESSAGES[category] ?? DEFAULT_ERROR;
      const refFooter = referenceId !== undefined ? ` ||*(reference: ${referenceId})*||` : '';
      return `${userMessage}${refFooter}`;
    }

    // No error info available - fall back to basic error message
    return result.personalityErrorMessage ?? DEFAULT_ERROR;
  }
}
