/**
 * Message Handler
 *
 * Coordinates message processing using Chain of Responsibility pattern.
 * Each processor in the chain handles a specific type of message.
 * Implements full dependency injection for testability and flexibility.
 */

import { MessageType, type Message } from 'discord.js';
import { createLogger, type LLMGenerationResult, stripErrorSpoiler } from '@tzurot/common-types';
import { buildErrorContent } from '../utils/buildErrorContent.js';
import type { IMessageProcessor } from '../processors/IMessageProcessor.js';
import { isUserContentMessage } from '../utils/messageTypeUtils.js';
import { DiscordResponseSender } from '../services/DiscordResponseSender.js';
import { ConversationPersistence } from '../services/ConversationPersistence.js';
import { JobTracker, type PendingJobContext } from '../services/JobTracker.js';
import { getGatewayClient } from '../services/serviceRegistry.js';

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
      await this.sendErrorResponse(jobId, buildErrorContent(result), result, jobContext);
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
      await this.sendErrorResponse(jobId, buildErrorContent(result), result, jobContext);
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
        showThinking: result.metadata?.showThinking,
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

      // Update diagnostic log with response message IDs (fire-and-forget)
      // This enables /admin debug to lookup by AI response message ID
      if (chunkMessageIds.length > 0) {
        void getGatewayClient()
          .updateDiagnosticResponseIds(result.requestId, chunkMessageIds)
          .catch(err => {
            logger.warn({ err }, '[MessageHandler] Failed to update diagnostic response IDs');
          });
      }

      logger.info(
        { jobId, chunks: chunkMessageIds.length },
        '[MessageHandler] Async job result delivered successfully'
      );
    } catch (error) {
      logger.error({ err: error, jobId }, '[MessageHandler] Error handling job result');
      // Try to notify user of the error via webhook (don't throw - we don't want to crash the listener)
      await this.sendErrorResponse(jobId, buildErrorContent(result), result, jobContext);
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

      // Update diagnostic log with response message IDs (fire-and-forget)
      // This enables /admin debug to lookup by AI error message ID
      if (chunkMessageIds.length > 0) {
        void getGatewayClient()
          .updateDiagnosticResponseIds(result.requestId, chunkMessageIds)
          .catch(err => {
            logger.warn(
              { err },
              '[MessageHandler] Failed to update diagnostic response IDs for error'
            );
          });
      }
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
}
