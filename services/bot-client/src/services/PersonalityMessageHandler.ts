/**
 * Personality Message Handler
 *
 * Thin Discord-shape adapter on top of PersonalityChatManager.
 * Owns: catching the manager's denied/error results and translating them
 * into the per-protocol Discord side effect (currently: silent skip on
 * denial, in-character error delivery via the webhook on exception).
 * Delegates everything else (gates, config, context, persistence, job
 * submission) to the manager.
 *
 * Used by DMSessionProcessor (the sole remaining caller — the mention/reply/
 * activation paths now fan out through MultiTagCoordinator instead).
 */

import type { Message } from 'discord.js';
import { ApiErrorCategory, ApiErrorType } from '@tzurot/common-types/constants/error';
import { type TypingChannel } from '@tzurot/common-types/types/discord-types';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { buildErrorContent } from '../utils/buildErrorContent.js';
import { type JobTracker } from './JobTracker.js';
import { type PersonalityChatManager } from './character/PersonalityChatManager.js';
import { type SlotDeliveryService } from './SlotDeliveryService.js';
import { buildSyntheticErrorResult } from './multiTagCoordinatorHelpers.js';

const logger = createLogger('PersonalityMessageHandler');

export interface PersonalityMessageHandlerDeps {
  manager: PersonalityChatManager;
  jobTracker: JobTracker;
  slotDelivery: SlotDeliveryService;
}

/**
 * Adapter routing Discord Messages through the chat manager and tracking the
 * resulting job. Stateless aside from its injected deps.
 */
export class PersonalityMessageHandler {
  private readonly manager: PersonalityChatManager;
  private readonly jobTracker: JobTracker;
  private readonly slotDelivery: SlotDeliveryService;

  constructor(deps: PersonalityMessageHandlerDeps) {
    this.manager = deps.manager;
    this.jobTracker = deps.jobTracker;
    this.slotDelivery = deps.slotDelivery;
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

      // Deliver the error IN CHARACTER: the persona's own `errorMessage` (else
      // a generic fallback) via its webhook, never the raw `error.message`
      // (internals like stack fragments must not reach users). `deliverErrorNoPersist`
      // skips history persistence — the submission threw before any turn was
      // created, so there's nothing to attribute. On webhook failure it falls
      // back to a plain reply internally.
      // `technicalMessage` is a SAFE LITERAL — the raw `error` is logged above
      // but must never reach the user-facing (spoilered) content per
      // 00-critical's no-raw-error-leak rule.
      const spec = buildSyntheticErrorResult(personality, {
        requestId: message.id,
        category: ApiErrorCategory.UNKNOWN,
        type: ApiErrorType.UNKNOWN,
        technicalMessage: 'Message handling failed',
      });
      await this.slotDelivery
        .deliverErrorNoPersist(buildErrorContent(spec), spec, {
          message,
          // This handler runs only for messages already routed to a typing
          // channel; if the cast is ever wrong the webhook send fails and
          // `deliverErrorNoPersist` falls back to a plain `message.reply`.
          channel: message.channel as TypingChannel,
          guildId: message.guildId,
          clientId: message.client.user?.id,
          personality,
          isAutoResponse: options.isAutoResponse ?? false,
        })
        .catch(replyError => {
          logger.warn(
            { err: replyError, messageId: message.id },
            'Failed to send in-character error message to user'
          );
        });
    }
  }
}
