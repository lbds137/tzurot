/**
 * DM Session Processor
 *
 * Handles "sticky" DM personality sessions. Once a user @mentions a personality in DMs,
 * subsequent messages go to that personality without needing to mention again.
 * Users can switch by mentioning a different personality.
 *
 * This processor should be placed AFTER ActivatedChannelProcessor but BEFORE
 * PersonalityMentionProcessor in the chain:
 * - ReplyMessageProcessor takes priority (explicit replies)
 * - DMSessionProcessor handles plain DM messages with active sessions
 * - PersonalityMentionProcessor handles explicit @mentions (which update the session)
 */

import type { Message, DMChannel } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { IMessageProcessor } from './IMessageProcessor.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { GatewayClient } from '../utils/GatewayClient.js';
import { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';
import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';
import {
  isDMChannel,
  checkNsfwVerification,
  trackPendingVerificationMessage,
  NSFW_VERIFICATION_MESSAGE,
} from '../utils/nsfwVerification.js';
import { getEffectiveContent } from '../utils/messageTypeUtils.js';

const logger = createLogger('DMSessionProcessor');

/**
 * Regex to match personality prefix in bot messages: **DisplayName:**
 * This pattern is used by webhook messages and identifies which personality sent a message.
 * Ephemeral messages (NSFW verification, help) don't have this prefix.
 */
const DM_PERSONALITY_PREFIX_REGEX = /^\*\*(.+?):\*\*/;

/**
 * How many recent messages to scan when looking for active personality
 */
const DM_MESSAGE_SCAN_LIMIT = 50;

/**
 * How long the help message stays before self-destructing (ms)
 */
const HELP_MESSAGE_DELETE_DELAY = 30_000;

export class DMSessionProcessor implements IMessageProcessor {
  constructor(
    private readonly gatewayClient: GatewayClient,
    private readonly personalityService: IPersonalityLoader,
    private readonly personalityHandler: PersonalityMessageHandler
  ) {}

  async process(message: Message): Promise<boolean> {
    // 1. Only process DM channels
    if (!isDMChannel(message.channel)) {
      return false;
    }

    const userId = message.author.id;
    const botId = message.client.user?.id;

    logger.debug({ userId }, '[DMSessionProcessor] Processing DM message');

    // 2. Check NSFW verification first (higher priority than help message)
    const nsfwStatus = await checkNsfwVerification(userId);
    if (!nsfwStatus.nsfwVerified) {
      logger.info({ userId }, '[DMSessionProcessor] DM blocked - user not NSFW verified');
      await this.sendVerificationMessage(message);
      return true; // Consume message
    }

    // 3. Find active personality from recent DM messages
    const personalityId = await this.findActivePersonality(message.channel as DMChannel, botId);

    if (personalityId === null || personalityId.length === 0) {
      // No active session - send self-destructing help message
      logger.debug({ userId }, '[DMSessionProcessor] No active session found');
      await this.sendHelpMessage(message);
      return true; // Consume message (don't continue chain)
    }

    // 3. Load personality with access control
    const personality = await this.personalityService.loadPersonality(personalityId, userId);

    if (!personality) {
      // Personality deleted or access revoked - send help
      logger.debug(
        { userId, personalityId },
        '[DMSessionProcessor] Personality not accessible, showing help'
      );
      await this.sendHelpMessage(message);
      return true;
    }

    // 4. Handle the message via existing infrastructure
    const voiceTranscript = VoiceMessageProcessor.getVoiceTranscript(message);
    const content = voiceTranscript ?? getEffectiveContent(message);

    logger.info(
      { userId, personalityName: personality.displayName },
      '[DMSessionProcessor] Routing DM to active personality session'
    );

    await this.personalityHandler.handleMessage(message, personality, content, {
      isAutoResponse: true,
    });

    return true; // Handled
  }

  /**
   * Find the active personality by looking at recent DM messages.
   * Finds most recent bot message with **DisplayName:** prefix and looks up
   * the personality via conversation history.
   */
  private async findActivePersonality(
    channel: DMChannel,
    botId: string | undefined
  ): Promise<string | null> {
    if (botId === undefined || botId.length === 0) {
      logger.warn({}, '[DMSessionProcessor] Bot ID not available');
      return null;
    }

    try {
      // Fetch recent messages
      const messages = await channel.messages.fetch({ limit: DM_MESSAGE_SCAN_LIMIT });

      // Find most recent bot message with personality prefix
      for (const msg of messages.values()) {
        if (msg.author.id !== botId) {
          continue;
        }

        const match = DM_PERSONALITY_PREFIX_REGEX.exec(msg.content);
        if (match === null) {
          continue; // Skip ephemeral messages (no prefix)
        }

        // Look up this message in conversation history
        const historyEntry = await this.gatewayClient.lookupPersonalityFromConversation(msg.id);
        if (historyEntry?.personalityId !== undefined && historyEntry.personalityId.length > 0) {
          logger.debug(
            { messageId: msg.id, personalityId: historyEntry.personalityId },
            '[DMSessionProcessor] Found active personality from conversation history'
          );
          return historyEntry.personalityId;
        }

        // If not in DB (very old message), we could try display name lookup as fallback
        // but for now, just continue to the next message
        logger.debug(
          { messageId: msg.id, displayName: match[1] },
          '[DMSessionProcessor] Message not found in conversation history, trying next'
        );
      }

      return null; // No personality messages found
    } catch (error) {
      logger.error({ err: error }, '[DMSessionProcessor] Error fetching DM messages');
      return null;
    }
  }

  /**
   * Send NSFW verification message and track for cleanup
   */
  private async sendVerificationMessage(message: Message): Promise<void> {
    try {
      const verificationReply = await message.reply(NSFW_VERIFICATION_MESSAGE);
      void trackPendingVerificationMessage(
        message.author.id,
        verificationReply.id,
        verificationReply.channelId
      ).catch(trackError => {
        logger.warn(
          { err: trackError, userId: message.author.id, messageId: verificationReply.id },
          '[DMSessionProcessor] Failed to track verification message'
        );
      });
    } catch (error) {
      logger.debug({ err: error }, '[DMSessionProcessor] Failed to send verification message');
    }
  }

  /**
   * Send a self-destructing help message explaining how to start a conversation
   */
  private async sendHelpMessage(message: Message): Promise<void> {
    try {
      const helpMsg = await message.reply({
        content: `**No active conversation**

To start chatting, mention a character:
\`@character_name hello\`

Or reply to any of my previous messages.`,
      });

      // Delete help message after delay
      setTimeout(() => {
        helpMsg.delete().catch(() => {
          // Ignore deletion failures (message may already be deleted)
        });
      }, HELP_MESSAGE_DELETE_DELAY);
    } catch (error) {
      // Ignore - user may have DMs disabled or other Discord API issues
      logger.debug({ err: error }, '[DMSessionProcessor] Failed to send help message');
    }
  }
}
