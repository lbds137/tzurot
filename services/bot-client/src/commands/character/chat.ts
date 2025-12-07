/**
 * Character Chat Command Handler
 *
 * Allows users to chat with a character using a slash command.
 * This provides an alternative to the @mention pattern.
 *
 * Flow:
 * 1. User selects character (autocomplete) and enters message
 * 2. Bot sends user's message as visible channel message: **Username:** message
 * 3. Bot calls gateway to generate AI response
 * 4. Bot sends character response via webhook
 */

import type {
  ChatInputCommandInteraction,
  TextChannel,
  ThreadChannel,
  GuildMember,
} from 'discord.js';
import { ChannelType } from 'discord.js';
import {
  createLogger,
  splitMessage,
  DISCORD_LIMITS,
  INTERVALS,
  TIMEOUTS,
} from '@tzurot/common-types';
import type { EnvConfig, LoadedPersonality } from '@tzurot/common-types';
import type { MessageContext } from '../../types.js';
import {
  getGatewayClient,
  getPersonalityService,
  getWebhookManager,
} from '../../services/serviceRegistry.js';
import { redisService } from '../../redis.js';

const logger = createLogger('character-chat');

/**
 * Build Discord environment context from interaction
 */
function buildEnvironment(interaction: ChatInputCommandInteraction): {
  type: 'guild' | 'dm';
  guild?: { id: string; name: string };
  channel: { id: string; name: string; type: string };
} {
  const { channel, guild } = interaction;

  if (!channel) {
    throw new Error('No channel available');
  }

  // Determine channel type string
  let channelType = 'unknown';
  if ('type' in channel) {
    if (channel.type === ChannelType.GuildText) {
      channelType = 'text';
    } else if (
      channel.type === ChannelType.PublicThread ||
      channel.type === ChannelType.PrivateThread
    ) {
      channelType = 'thread';
    }
  }

  const channelName = 'name' in channel && channel.name !== null ? channel.name : 'DM';

  const environment = {
    type: guild ? ('guild' as const) : ('dm' as const),
    guild: guild
      ? {
          id: guild.id,
          name: guild.name,
        }
      : undefined,
    channel: {
      id: channel.id,
      name: channelName,
      type: channelType,
    },
  };

  return environment;
}

/**
 * Handle /character chat subcommand
 */
export async function handleChat(
  interaction: ChatInputCommandInteraction,
  _config: EnvConfig
): Promise<void> {
  const characterSlug = interaction.options.getString('character', true);
  const message = interaction.options.getString('message', true);
  const userId = interaction.user.id;
  // Get display name - handle both GuildMember and APIInteractionGuildMember
  const member = interaction.member as GuildMember | null;
  const displayName = member?.displayName ?? interaction.user.displayName;

  logger.info(
    { characterSlug, userId, messageLength: message.length },
    '[Character Chat] Processing chat request'
  );

  // Defer while we process (but NOT ephemeral - we want visible messages)
  await interaction.deferReply();

  try {
    // 1. Load the personality
    const personalityService = getPersonalityService();
    const personality = await personalityService.loadPersonality(characterSlug, userId);

    if (!personality) {
      await interaction.editReply({
        content: `Character "${characterSlug}" not found or you don't have access.`,
      });
      return;
    }

    // 2. Verify we're in a webhook-capable channel
    const { channel } = interaction;
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.PublicThread &&
        channel.type !== ChannelType.PrivateThread)
    ) {
      await interaction.editReply({
        content: 'This command can only be used in text channels or threads.',
      });
      return;
    }

    // 3. Delete the deferred reply (we'll send our own messages)
    await interaction.deleteReply();

    // 4. Send the user's message as a visible channel message
    const userMessageContent = `**${displayName}:** ${message}`;
    await channel.send(userMessageContent);

    // 5. Build context for AI generation
    const context: MessageContext = {
      messageContent: message,
      userId,
      userName: displayName,
      environment: buildEnvironment(interaction),
      conversationHistory: [], // No history for chat command (could be enhanced later)
    };

    // 6. Submit job to gateway
    const gatewayClient = getGatewayClient();
    const { jobId } = await gatewayClient.generate(personality, context);

    logger.info({ jobId, characterSlug }, '[Character Chat] Job submitted, polling for result');

    // 7. Show typing indicator while waiting
    await channel.sendTyping();

    // 8. Poll for result (with typing indicator refresh)
    // NOTE: setInterval is a known scaling blocker (see CLAUDE.md "Timer Patterns")
    // Acceptable here as it's short-lived and cleared in finally block
    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {
        // Ignore typing errors
      });
    }, INTERVALS.TYPING_INDICATOR_REFRESH);

    try {
      const result = await gatewayClient.pollJobUntilComplete(jobId, {
        maxWaitMs: TIMEOUTS.JOB_BASE,
        pollIntervalMs: INTERVALS.JOB_POLL_INTERVAL,
      });

      clearInterval(typingInterval);

      if (result?.content === undefined || result.content === null || result.content === '') {
        await channel.send(`*${personality.displayName} is having trouble responding right now.*`);
        return;
      }

      // 9. Send AI response via webhook
      await sendCharacterResponse(
        channel as TextChannel | ThreadChannel,
        personality,
        result.content,
        result.metadata?.modelUsed,
        result.metadata?.isGuestMode
      );

      logger.info({ jobId, characterSlug }, '[Character Chat] Response sent successfully');
    } finally {
      clearInterval(typingInterval);
    }
  } catch (error) {
    logger.error({ err: error, characterSlug }, '[Character Chat] Error processing chat');

    // Try to send error message
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          content: 'Sorry, something went wrong. Please try again.',
        });
      }
    } catch {
      // Interaction may have been deleted, try channel send
      const ch = interaction.channel;
      if (ch && 'send' in ch && typeof ch.send === 'function') {
        await ch.send('Sorry, something went wrong. Please try again.');
      }
    }
  }
}

/**
 * Send character response via webhook
 */
async function sendCharacterResponse(
  channel: TextChannel | ThreadChannel,
  personality: LoadedPersonality,
  content: string,
  modelUsed?: string,
  isGuestMode?: boolean
): Promise<void> {
  const webhookManager = getWebhookManager();

  // Build footer
  let footer = '';
  if (modelUsed !== undefined && modelUsed !== null && modelUsed !== '') {
    const modelUrl = `https://openrouter.ai/models/${modelUsed}`;
    footer = `\n-# Model: [${modelUsed}](<${modelUrl}>)`;
  }
  if (isGuestMode === true) {
    footer += '\n-# Running in guest mode (free models)';
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
      await redisService.storeWebhookMessage(sentMessage.id, personality.name);
    }
  }
}
