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
  MESSAGE_LIMITS,
  GUEST_MODE,
  AI_ENDPOINTS,
  characterChatOptions,
} from '@tzurot/common-types';
import type { EnvConfig, LoadedPersonality } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { MessageContext } from '../../types.js';
import {
  getGatewayClient,
  getPersonalityService,
  getWebhookManager,
  getConversationHistoryService,
  getPersonaResolver,
} from '../../services/serviceRegistry.js';
import { redisService } from '../../redis.js';

const logger = createLogger('character-chat');

/**
 * Channel types that support webhook responses
 */
type WebhookChannel = TextChannel | ThreadChannel;

/**
 * Resolve the user's display name using persona resolver.
 * Falls back to Discord display name if persona resolution fails.
 */
async function resolveDisplayName(
  userId: string,
  personalityId: string,
  discordDisplayName: string
): Promise<string> {
  try {
    const personaResolver = getPersonaResolver();
    const personaResult = await personaResolver.resolve(userId, personalityId);
    if (
      personaResult.config.preferredName !== null &&
      personaResult.config.preferredName !== undefined &&
      personaResult.config.preferredName.length > 0
    ) {
      logger.debug(
        { userId, personalityId, source: personaResult.source },
        '[Character Chat] Using persona preferredName'
      );
      return personaResult.config.preferredName;
    }
  } catch {
    logger.debug({ userId }, '[Character Chat] Failed to resolve persona, using Discord name');
  }
  return discordDisplayName;
}

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
 * Build Discord environment context from a deferred command context.
 *
 * Extracts guild, channel, and type information to provide context
 * for AI personality responses about where the conversation is happening.
 *
 * @param context - The deferred command context
 * @returns Environment object with guild/channel metadata
 * @throws Error if channel is unavailable (should never happen in valid interactions)
 *
 * @example
 * const env = buildEnvironment(context);
 * // Returns: { type: 'guild', guild: { id: '123', name: 'My Server' }, channel: { id: '456', name: 'general', type: 'text' } }
 */
function buildEnvironment(context: DeferredCommandContext): {
  type: 'guild' | 'dm';
  guild?: { id: string; name: string };
  channel: { id: string; name: string; type: string };
} {
  const channel = context.channel;
  const guild = context.guild;

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

    // 3. Resolve display name (persona override or Discord name)
    const displayName = await resolveDisplayName(userId, personality.id, discordDisplayName);

    // 4. Fetch conversation history
    const history = await getConversationHistoryService().getRecentHistory(
      channel.id,
      personality.id,
      MESSAGE_LIMITS.MAX_HISTORY_FETCH
    );

    // 5. Weigh-in mode requires existing conversation
    if (isWeighInMode && history.length === 0) {
      await context.editReply({
        content: `❌ No conversation history found for **${personality.displayName}** in this channel.\nStart a conversation first, or provide a message.`,
      });
      return;
    }

    // 6. Delete deferred reply and send user message (chat mode only)
    await context.deleteReply();
    if (!isWeighInMode) {
      await channel.send(`**${displayName}:** ${message}`);
    }

    // 7. Build message context for AI
    const conversationHistory = history.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
      personaId: msg.personaId,
      personaName: msg.personaName,
    }));

    const messageContext: MessageContext = {
      messageContent: isWeighInMode ? WEIGH_IN_MESSAGE : message,
      userId,
      userName: displayName,
      environment: buildEnvironment(context),
      conversationHistory,
    };

    // 8. Submit job and poll for response
    const { jobId } = await getGatewayClient().generate(personality, messageContext);
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
