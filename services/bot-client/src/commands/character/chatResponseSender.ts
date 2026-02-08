/**
 * Character response sender.
 *
 * Sends AI-generated responses as webhook messages in Discord,
 * splitting content into chunks if needed and appending model footer.
 */

import type { TextChannel, ThreadChannel } from 'discord.js';
import {
  splitMessage,
  DISCORD_LIMITS,
  AI_ENDPOINTS,
  GUEST_MODE,
  buildModelFooterText,
} from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import { getWebhookManager } from '../../services/serviceRegistry.js';
import { redisService } from '../../redis.js';

/**
 * Send character response via webhook.
 * Returns the message IDs of all sent chunks.
 */
export async function sendCharacterResponse(
  channel: TextChannel | ThreadChannel,
  personality: LoadedPersonality,
  content: string,
  modelUsed?: string,
  isGuestMode?: boolean
): Promise<string[]> {
  const webhookManager = getWebhookManager();
  const messageIds: string[] = [];

  // Build footer (using centralized constants from BOT_FOOTER_TEXT)
  let footer = '';
  if (modelUsed !== undefined && modelUsed !== null && modelUsed !== '') {
    const modelUrl = `${AI_ENDPOINTS.OPENROUTER_MODEL_CARD_URL}/${modelUsed}`;
    footer = `\n-# ${buildModelFooterText(modelUsed, modelUrl)}`;
  }
  if (isGuestMode === true) {
    footer += `\n-# ${GUEST_MODE.FOOTER_MESSAGE}`;
  }

  // Split into chunks if needed
  const chunks = splitMessage(content);

  // Append footer to last chunk
  if (chunks.length > 0 && footer.length > 0) {
    const lastIndex = chunks.length - 1;
    if (chunks[lastIndex].length + footer.length <= DISCORD_LIMITS.MESSAGE_LENGTH) {
      chunks[lastIndex] += footer;
    } else {
      chunks.push(footer.trimStart());
    }
  }

  // Send each chunk via webhook
  for (const chunk of chunks) {
    const sentMessage = await webhookManager.sendAsPersonality(channel, personality, chunk);
    if (sentMessage !== undefined && sentMessage !== null) {
      // Store in Redis for reply routing
      await redisService.storeWebhookMessage(sentMessage.id, personality.id);
      // Collect message ID for diagnostic tracking
      messageIds.push(sentMessage.id);
    }
  }

  return messageIds;
}
