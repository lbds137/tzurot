/**
 * Character Chat Command Handler
 *
 * Allows users to chat with a character using a slash command.
 * This provides an alternative to the @mention pattern.
 *
 * Supports two modes:
 * 1. **Chat mode** (message provided):
 *    - Bot sends user's message as visible channel message: **Username:** message
 *    - Character responds to that message
 *
 * 2. **Weigh-in mode** (no message):
 *    - No user message is sent to the channel
 *    - Character is "summoned" to contribute to the ongoing conversation
 *    - Uses conversation history to generate a contextual response
 */

import type { TextChannel, ThreadChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import {
  createLogger,
  splitMessage,
  DISCORD_LIMITS,
  INTERVALS,
  TIMEOUTS,
  GUEST_MODE,
  AI_ENDPOINTS,
  characterChatOptions,
} from '@tzurot/common-types';
import type { EnvConfig, LoadedPersonality } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  getGatewayClient,
  getPersonalityService,
  getWebhookManager,
  getMessageContextBuilder,
} from '../../services/serviceRegistry.js';
import type { InteractionContextParams } from '../../services/MessageContextBuilder.js';
import { redisService } from '../../redis.js';

const logger = createLogger('character-chat');

/**
 * Channel types that support webhook responses
 */
type WebhookChannel = TextChannel | ThreadChannel;

/**
 * Validate that the channel supports webhook responses.
 * Returns the channel cast to WebhookChannel if valid, null otherwise.
 */
function validateWebhookChannel(context: DeferredCommandContext): WebhookChannel | null {
  const channel = context.channel;
  if (
    !channel ||
    (channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.PublicThread &&
      channel.type !== ChannelType.PrivateThread)
  ) {
    return null;
  }
  return channel as WebhookChannel;
}

/**
 * Poll for job completion and send the character response.
 * Returns true if successful, false if there was an error.
 */
async function pollAndSendResponse(
  jobId: string,
  channel: WebhookChannel,
  personality: LoadedPersonality,
  characterSlug: string,
  isWeighInMode: boolean
): Promise<boolean> {
  const gatewayClient = getGatewayClient();

  // Show typing indicator while waiting
  await channel.sendTyping();

  // Poll with typing indicator refresh (safe short-lived timer, see CLAUDE.md)
  const typingInterval = setInterval(() => {
    channel.sendTyping().catch(() => {
      // Ignore typing errors - channel may be unavailable
    });
  }, INTERVALS.TYPING_INDICATOR_REFRESH);

  try {
    const result = await gatewayClient.pollJobUntilComplete(jobId, {
      maxWaitMs: TIMEOUTS.JOB_BASE,
      pollIntervalMs: INTERVALS.JOB_POLL_INTERVAL,
    });

    if (result?.content === undefined || result.content === null || result.content === '') {
      await channel.send(`*${personality.displayName} is having trouble responding right now.*`);
      return false;
    }

    await sendCharacterResponse(
      channel,
      personality,
      result.content,
      result.metadata?.modelUsed,
      result.metadata?.isGuestMode
    );

    logger.info(
      { jobId, characterSlug, isWeighInMode },
      '[Character Chat] Response sent successfully'
    );
    return true;
  } finally {
    clearInterval(typingInterval);
  }
}

/**
 * Extract channel type string from DeferredCommandContext
 */
function getChannelType(context: DeferredCommandContext): string {
  const channel = context.channel;
  if (!channel || !('type' in channel)) {
    return 'unknown';
  }
  if (channel.type === ChannelType.GuildText) {
    return 'text';
  }
  if (channel.type === ChannelType.PublicThread || channel.type === ChannelType.PrivateThread) {
    return 'thread';
  }
  return 'unknown';
}

/**
 * Weigh-in mode indicator message
 * This signals to the AI that the character is being summoned to contribute
 * to an ongoing conversation rather than responding to a specific user message.
 */
const WEIGH_IN_MESSAGE =
  '[The user has summoned you to join this conversation. Contribute naturally based on the context above.]';

/**
 * Handle /character chat subcommand
 *
 * Supports two modes:
 * - Chat mode (message provided): User sends message, character responds
 * - Weigh-in mode (no message): Character contributes to ongoing conversation
 *
 * Uses MessageContextBuilder for feature parity with @mentions:
 * - Context epoch support (/history clear honored)
 * - Guild member info (roles, color, join date)
 * - User timezone for date/time formatting
 */
export async function handleChat(
  context: DeferredCommandContext,
  _config: EnvConfig
): Promise<void> {
  const options = characterChatOptions(context.interaction);
  const characterSlug = options.character();
  const message = options.message();
  const userId = context.user.id;
  const isWeighInMode = message === null || message.trim().length === 0;
  const discordDisplayName = context.member?.displayName ?? context.user.displayName;

  logger.info(
    { characterSlug, userId, messageLength: message?.length ?? 0, isWeighInMode },
    '[Character Chat] Processing chat request'
  );

  try {
    // 1. Load and validate personality
    const personality = await getPersonalityService().loadPersonality(characterSlug, userId);
    if (!personality) {
      await context.editReply({ content: `❌ Character "${characterSlug}" not found.` });
      return;
    }

    // 2. Validate channel supports webhooks
    const channel = validateWebhookChannel(context);
    if (!channel) {
      await context.editReply({
        content: 'This command can only be used in text channels or threads.',
      });
      return;
    }

    // 3. Build interaction context parameters
    const channelName = 'name' in channel && channel.name !== null ? channel.name : 'channel';
    const interactionParams: InteractionContextParams = {
      userId: context.user.id,
      username: context.user.username,
      displayName: discordDisplayName,
      isBot: context.user.bot,
      channelId: channel.id,
      guildId: context.guild?.id,
      guildName: context.guild?.name,
      channelName,
      channelType: getChannelType(context),
      member: context.member,
    };

    // 4. Build context using MessageContextBuilder
    // This provides: persona resolution, context epoch, guild member info, user timezone
    const contextBuilder = getMessageContextBuilder();
    // In weigh-in mode, use special prompt. In chat mode, message is guaranteed non-null.
    const messageContent =
      message !== null && message.trim().length > 0 ? message : WEIGH_IN_MESSAGE;
    const buildResult = await contextBuilder.buildContextFromInteraction(
      interactionParams,
      personality,
      messageContent
    );

    // 5. Weigh-in mode requires existing conversation
    if (isWeighInMode && buildResult.conversationHistory.length === 0) {
      await context.editReply({
        content: `❌ No conversation history found for **${personality.displayName}** in this channel.\nStart a conversation first, or provide a message.`,
      });
      return;
    }

    // 6. Get display name from context build (persona name or Discord name)
    const displayName = buildResult.personaName ?? discordDisplayName;

    // 7. Delete deferred reply and send user message (chat mode only)
    await context.deleteReply();
    if (!isWeighInMode) {
      await channel.send(`**${displayName}:** ${message}`);
    }

    // 8. Submit job and poll for response
    const { jobId } = await getGatewayClient().generate(personality, buildResult.context);
    logger.info({ jobId, characterSlug, isWeighInMode }, '[Character Chat] Job submitted');

    await pollAndSendResponse(jobId, channel, personality, characterSlug, isWeighInMode);
  } catch (error) {
    logger.error({ err: error, characterSlug }, '[Character Chat] Error processing chat');
    await handleChatError(context);
  }
}

/**
 * Handle errors in chat command by sending error message to user
 */
async function handleChatError(context: DeferredCommandContext): Promise<void> {
  try {
    const { interaction } = context;
    if (interaction.replied || interaction.deferred) {
      await context.editReply({ content: 'Sorry, something went wrong. Please try again.' });
    }
  } catch {
    const ch = context.channel;
    if (ch && 'send' in ch && typeof ch.send === 'function') {
      await ch.send('Sorry, something went wrong. Please try again.');
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
    const modelUrl = `${AI_ENDPOINTS.OPENROUTER_MODEL_CARD_URL}/${modelUsed}`;
    footer = `\n-# Model: [${modelUsed}](<${modelUrl}>)`;
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
    }
  }
}
