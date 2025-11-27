/**
 * Message Handler
 *
 * Coordinates message processing using Chain of Responsibility pattern.
 * Each processor in the chain handles a specific type of message.
 * Implements full dependency injection for testability and flexibility.
 */

import type { Message } from 'discord.js';
import { createLogger, type LLMGenerationResult } from '@tzurot/common-types';
import type { IMessageProcessor } from '../processors/IMessageProcessor.js';
import { DiscordResponseSender } from '../services/DiscordResponseSender.js';
import { ConversationPersistence } from '../services/ConversationPersistence.js';
import { JobTracker } from '../services/JobTracker.js';

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

    const { message, personality, personaId, userMessageContent, userMessageTime } = jobContext;

    // Handle explicit failure from ai-worker (success: false)
    if (result.success === false) {
      logger.error(
        { jobId, error: result.error },
        '[MessageHandler] Job failed with error from ai-worker'
      );

      // Use personality's custom error message if available, otherwise generic
      const errorContent =
        result.personalityErrorMessage ??
        'Sorry, I encountered an error generating a response. Please try again later.';

      // Send error via personality webhook (not parent bot)
      try {
        await this.responseSender.sendResponse({
          content: errorContent,
          personality,
          message,
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

      // Use personality's custom error message if available
      const errorContent =
        result.personalityErrorMessage ??
        'Sorry, I encountered an error generating a response. Please try again later.';

      // Send error via personality webhook
      try {
        await this.responseSender.sendResponse({
          content: errorContent,
          personality,
          message,
        });
      } catch (sendError) {
        logger.error(
          { err: sendError, jobId },
          '[MessageHandler] Failed to send error via webhook'
        );
      }
      return;
    }

    try {
      // Upgrade user message from placeholders to rich descriptions
      await this.persistence.updateUserMessage(
        message,
        personality,
        personaId,
        userMessageContent,
        result.attachmentDescriptions,
        result.referencedMessagesDescriptions
      );

      // Send AI response to Discord
      const { chunkMessageIds } = await this.responseSender.sendResponse({
        content: result.content,
        personality,
        message,
        modelUsed: result.metadata?.modelUsed,
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
      const errorContent =
        result.personalityErrorMessage ??
        'Sorry, I encountered an error while processing your request.';

      try {
        await this.responseSender.sendResponse({
          content: errorContent,
          personality,
          message,
        });
      } catch (sendError) {
        logger.error(
          { err: sendError, jobId },
          '[MessageHandler] Failed to send error via webhook, falling back to reply'
        );
        await message.reply(errorContent).catch(() => {
          // Intentionally ignore reply failures - we've already logged the webhook error
        });
      }
    }
  }
}
