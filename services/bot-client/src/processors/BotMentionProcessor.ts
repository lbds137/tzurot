/**
 * Bot Mention Processor
 *
 * Handles generic bot mentions (not a specific personality).
 * Sends a help message guiding users on how to interact with personalities.
 * Last processor in the chain - fallback for unhandled mentions.
 */

import type { Message } from 'discord.js';
import { createLogger, getConfig } from '@tzurot/common-types';
import type { IMessageProcessor } from './IMessageProcessor.js';

const logger = createLogger('BotMentionProcessor');

export class BotMentionProcessor implements IMessageProcessor {
  async process(message: Message): Promise<boolean> {
    // Check for generic bot mention
    if (!message.mentions.has(message.client.user)) {
      return false; // No bot mention, message is unhandled
    }

    logger.debug(
      { userId: message.author.id, channelId: message.channelId },
      '[BotMentionProcessor] Processing generic bot mention, sending help'
    );

    const config = getConfig();
    const mentionChar = config.BOT_MENTION_CHAR;

    // Send a helpful guide message
    await message.reply({
      content: [
        `👋 Hi! I'm a bot that hosts multiple AI personalities.`,
        ``,
        `**How to chat:**`,
        `• Mention a personality: \`${mentionChar}personality your message\``,
        `• Reply to a personality's message to continue the conversation`,
        `• Use \`/character chat\` to start a conversation via slash command`,
        ``,
        `Use \`/character list\` to see available personalities.`,
      ].join('\n'),
    });

    return true; // Stop processing (mention was handled with help message)
  }
}
