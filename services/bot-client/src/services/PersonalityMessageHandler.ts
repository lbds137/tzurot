/**
 * Personality Message Handler
 *
 * Thin Discord-shape adapter on top of PersonalityChatManager.
 * Owns: catching the manager's denied/error results and translating them
 * into the per-protocol Discord side effect (currently: silent skip on
 * denial, error reply to user on exception). Delegates everything else
 * (gates, config, context, persistence, job submission) to the manager.
 *
 * Used by ReplyMessageProcessor, PersonalityMentionProcessor,
 * ActivatedChannelProcessor, and DMSessionProcessor.
 */

import type { Message } from 'discord.js';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { classifyGatewayFailure } from '../ux/catalog/classify.js';
import { renderSpec } from '../ux/render/render.js';
import { type JobTracker } from './JobTracker.js';
import { type PersonalityChatManager } from './character/PersonalityChatManager.js';

const logger = createLogger('PersonalityMessageHandler');

export interface PersonalityMessageHandlerDeps {
  manager: PersonalityChatManager;
  jobTracker: JobTracker;
}

/**
 * Adapter routing Discord Messages through the chat manager and tracking the
 * resulting job. Stateless aside from its injected deps.
 */
export class PersonalityMessageHandler {
  private readonly manager: PersonalityChatManager;
  private readonly jobTracker: JobTracker;

  constructor(deps: PersonalityMessageHandlerDeps) {
    this.manager = deps.manager;
    this.jobTracker = deps.jobTracker;
  }

  /**
   * Handle a message directed at a personality.
   *
   * @param message - Discord message
   * @param personality - Target personality
   * @param content - Message content (may be voice transcript)
   * @param options.isAutoResponse - True for channel-activation auto-responses
   */
  async handleMessage(
    message: Message,
    personality: LoadedPersonality,
    content: string,
    options: { isAutoResponse?: boolean } = {}
  ): Promise<void> {
    try {
      const result = await this.manager.submitChatJob({
        message,
        personality,
        content,
        isAutoResponse: options.isAutoResponse,
      });

      if (result.kind !== 'submitted') {
        logger.debug(
          {
            reason: result.reason,
            personalityId: personality.id,
            messageId: message.id,
          },
          'Chat job not submitted'
        );
        return;
      }

      this.jobTracker.trackJob(result.jobId, result.trackingContext);
    } catch (error) {
      logger.error({ err: error }, 'Error handling personality message');

      // Classified catalog line — never the raw error.message (internals like
      // stack fragments and connection errors must not reach users). The
      // in-character delivery upgrade for this path is a separate step.
      const spec = classifyGatewayFailure(error, 'message', {
        failedAction: 'process your message',
      });
      await message.reply(renderSpec(spec)).catch(replyError => {
        logger.warn(
          { err: replyError, messageId: message.id },
          'Failed to send error message to user'
        );
      });
    }
  }
}
