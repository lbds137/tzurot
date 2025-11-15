/**
 * Reply Message Processor
 *
 * Handles replies to personality webhook messages.
 * Best UX - users can continue conversations by simply replying (no @mention needed).
 */

import type { Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { IMessageProcessor } from './IMessageProcessor.js';
import { ReplyResolutionService } from '../services/ReplyResolutionService.js';
import { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';
import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';

const logger = createLogger('ReplyMessageProcessor');

export class ReplyMessageProcessor implements IMessageProcessor {
  constructor(
    private readonly replyResolver: ReplyResolutionService,
    private readonly personalityHandler: PersonalityMessageHandler
  ) {}

  async process(message: Message): Promise<boolean> {
    // Check if this is a reply
    if (!message.reference) {
      return false; // Not a reply, continue to next processor
    }

    logger.debug('[ReplyMessageProcessor] Processing reply message');

    // Resolve which personality this reply targets
    const personality = await this.replyResolver.resolvePersonality(message);

    if (!personality) {
      // Reply is not to a personality webhook
      return false; // Continue to next processor
    }

    // Get voice transcript if available (set by VoiceMessageProcessor)
    const voiceTranscript = VoiceMessageProcessor.getVoiceTranscript(message);
    const content = voiceTranscript || message.content;

    // Handle the personality message
    await this.personalityHandler.handleMessage(message, personality, content);

    return true; // Stop processing (reply was handled)
  }
}
