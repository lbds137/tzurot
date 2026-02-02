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

import type { TextChannel, ThreadChannel, Message } from 'discord.js';
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
  buildModelFooterText,
} from '@tzurot/common-types';
import type {
  EnvConfig,
  LoadedPersonality,
  ResolvedExtendedContextSettings,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  getGatewayClient,
  getPersonalityService,
  getWebhookManager,
  getMessageContextBuilder,
  getConversationPersistence,
  getExtendedContextResolver,
  getPersonaResolver,
} from '../../services/serviceRegistry.js';
import type { MessageContext } from '../../types.js';
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
 * Result of polling and sending the response
 */
interface PollAndSendResult {
  success: boolean;
  /** Message IDs of the response chunks sent via webhook */
  responseMessageIds: string[];
  /** The response content (for conversation persistence) */
  content?: string;
}

/**
 * Poll for job completion and send the character response.
 * Returns success status and the message IDs of sent responses.
 */
async function pollAndSendResponse(
  jobId: string,
  channel: WebhookChannel,
  personality: LoadedPersonality,
  characterSlug: string,
  isWeighInMode: boolean
): Promise<PollAndSendResult> {
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
      return { success: false, responseMessageIds: [] };
    }

    const responseMessageIds = await sendCharacterResponse(
      channel,
      personality,
      result.content,
      result.metadata?.modelUsed,
      result.metadata?.isGuestMode
    );

    logger.info(
      { jobId, characterSlug, isWeighInMode, responseCount: responseMessageIds.length },
      '[Character Chat] Response sent successfully'
    );
    return { success: true, responseMessageIds, content: result.content };
  } finally {
    clearInterval(typingInterval);
  }
}

/**
 * Weigh-in mode indicator message
 * Minimal prompt that tells the AI to respond to conversation context
 * without meta-awareness of being explicitly invoked.
 */
const WEIGH_IN_MESSAGE = '[Reply naturally to the context above]';

/**
 * Result of getting the anchor message for context building
 */
interface AnchorMessageResult {
  success: true;
  message: Message;
}

interface AnchorMessageError {
  success: false;
  error: string;
}

type GetAnchorMessageResult = AnchorMessageResult | AnchorMessageError;

/**
 * Get an anchor message for context building.
 * Chat mode: send user message and return it.
 * Weigh-in mode: fetch the latest message in channel.
 */
async function getAnchorMessage(
  channel: WebhookChannel,
  isWeighInMode: boolean,
  sendUserMessageParams: SendUserMessageParams | null
): Promise<GetAnchorMessageResult> {
  if (!isWeighInMode && sendUserMessageParams !== null) {
    const message = await sendAndPersistUserMessage(sendUserMessageParams);
    return { success: true, message };
  }

  // Weigh-in mode: Fetch the most recent message in channel as anchor
  const recentMessages = await channel.messages.fetch({ limit: 1 });
  const latestMessage = recentMessages.first();
  if (latestMessage === undefined) {
    return { success: false, error: '❌ No conversation history found in this channel.' };
  }
  return { success: true, message: latestMessage };
}

/**
 * Adjust context for weigh-in mode by clearing persona info.
 * In weigh-in mode, the prompt is a system instruction, not a user message.
 */
function adjustContextForWeighInMode(
  buildResult: { context: MessageContext; conversationHistory: unknown[] },
  isWeighInMode: boolean
): boolean {
  // Check for conversation history in weigh-in mode
  if (isWeighInMode && buildResult.conversationHistory.length === 0) {
    return false;
  }

  // In weigh-in mode, clear persona info so no <from> tag is added
  if (isWeighInMode) {
    buildResult.context.activePersonaId = undefined;
    buildResult.context.activePersonaName = undefined;
  }

  return true;
}

/**
 * Parameters for sending user message to Discord
 */
interface SendUserMessageParams {
  channel: WebhookChannel;
  displayName: string;
  message: string;
  personality: LoadedPersonality;
  personaId: string;
  guildId: string | null;
  /** Timestamp for ensuring user < assistant ordering */
  timestamp: Date;
}

/**
 * Send user message to Discord and save to conversation history.
 * Returns the Message object for context building and trigger tracking.
 */
async function sendAndPersistUserMessage(params: SendUserMessageParams): Promise<Message> {
  const { channel, displayName, message, personality, personaId, guildId, timestamp } = params;

  const userMsg = await channel.send(`**${displayName}:** ${message}`);

  // Fire-and-forget persistence: Trade-off between responsiveness and guaranteed persistence.
  // If save fails (DB issues), the Discord message is still sent but won't be in history.
  // This matches the @mention pattern and prioritizes UX over perfect data consistency.
  // Pass explicit timestamp to ensure user message < assistant message ordering.
  void getConversationPersistence()
    .saveUserMessageFromFields({
      channelId: channel.id,
      guildId,
      discordMessageId: userMsg.id,
      personality,
      personaId,
      messageContent: message,
      timestamp,
    })
    .catch(err => {
      logger.warn({ err, messageId: userMsg.id }, '[Character Chat] Failed to save user message');
    });

  return userMsg;
}

/**
 * Parameters for submitting job and tracking diagnostics/persistence
 */
interface SubmitJobParams {
  channel: WebhookChannel;
  personality: LoadedPersonality;
  context: MessageContext;
  characterSlug: string;
  isWeighInMode: boolean;
  /** For conversation persistence */
  personaId: string;
  guildId: string | null;
  userMessageTime: Date;
}

/**
 * Submit job, poll for response, and handle diagnostic tracking + persistence.
 * Extracted to reduce complexity of main handler.
 */
async function submitAndTrackJob(params: SubmitJobParams): Promise<void> {
  const {
    channel,
    personality,
    context,
    characterSlug,
    isWeighInMode,
    personaId,
    guildId,
    userMessageTime,
  } = params;

  const { jobId, requestId } = await getGatewayClient().generate(personality, context);
  logger.info({ jobId, requestId, characterSlug, isWeighInMode }, '[Character Chat] Job submitted');

  const pollResult = await pollAndSendResponse(
    jobId,
    channel,
    personality,
    characterSlug,
    isWeighInMode
  );

  // Store response message IDs for diagnostic lookup (fire-and-forget)
  // May fail if diagnostic log expired (24h TTL) - acceptable for debug data
  if (pollResult.responseMessageIds.length > 0) {
    void getGatewayClient()
      .updateDiagnosticResponseIds(requestId, pollResult.responseMessageIds)
      .catch(err => {
        logger.warn(
          { err, requestId },
          '[Character Chat] Failed to update diagnostic response IDs'
        );
      });
  }

  // Fire-and-forget persistence (see comment at line 202 for trade-off rationale)
  if (pollResult.success && pollResult.content !== undefined) {
    void getConversationPersistence()
      .saveAssistantMessageFromFields({
        channelId: channel.id,
        guildId,
        personality,
        personaId,
        content: pollResult.content,
        chunkMessageIds: pollResult.responseMessageIds,
        userMessageTime,
      })
      .catch(err => {
        logger.warn({ err, jobId }, '[Character Chat] Failed to save assistant message');
      });
  }
}

/** Parameters for building chat context */
interface BuildChatContextParams {
  anchorMessage: Message;
  personality: LoadedPersonality;
  messageContent: string;
  extendedContextSettings: ResolvedExtendedContextSettings;
  commandContext: DeferredCommandContext;
  isWeighInMode: boolean;
}

/**
 * Build context for chat command with proper user identity override.
 */
async function buildChatContext(
  params: BuildChatContextParams
): Promise<{ context: MessageContext; personaId: string } | null> {
  const {
    anchorMessage,
    personality,
    messageContent,
    extendedContextSettings,
    commandContext,
    isWeighInMode,
  } = params;

  const contextBuilder = getMessageContextBuilder();
  const buildResult = await contextBuilder.buildContext(
    anchorMessage,
    personality,
    messageContent,
    {
      extendedContext: extendedContextSettings,
      botUserId: anchorMessage.client.user?.id,
      overrideUser: commandContext.user,
      overrideMember: commandContext.member ?? null, // null for DMs
    }
  );

  // Adjust context for weigh-in mode (validate history + clear persona)
  const hasValidContext = adjustContextForWeighInMode(buildResult, isWeighInMode);
  if (!hasValidContext) {
    return null;
  }

  // Set trigger message ID for diagnostic tracking (chat mode only)
  if (!isWeighInMode) {
    buildResult.context.triggerMessageId = anchorMessage.id;
  }

  return { context: buildResult.context, personaId: buildResult.personaId };
}

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

    // 3. Resolve persona to get display name (quick lookup before sending message)
    const personaResult = await getPersonaResolver().resolve(userId, personality.id);
    const displayName = personaResult.config.preferredName ?? discordDisplayName;

    // 4. Resolve extended context settings for this channel + personality
    const extendedContextSettings = await getExtendedContextResolver().resolveAll(
      channel.id,
      personality
    );

    // 5. Delete deferred reply before sending messages
    await context.deleteReply();

    // Capture timestamp for conversation ordering (user message < assistant message)
    const userMessageTime = new Date();

    // 6. Get a Discord Message object to use for context building with extended context
    const anchorResult = await getAnchorMessage(
      channel,
      isWeighInMode,
      isWeighInMode
        ? null
        : {
            channel,
            displayName,
            message,
            personality,
            personaId: personaResult.config.personaId,
            guildId: context.guild?.id ?? null,
            timestamp: userMessageTime,
          }
    );

    if (!anchorResult.success) {
      await channel.send(anchorResult.error);
      return;
    }
    const anchorMessage = anchorResult.message;

    // 7. Build full context with command invoker's identity (not anchor message author)
    const messageContent = isWeighInMode ? WEIGH_IN_MESSAGE : message;
    const buildResult = await buildChatContext({
      anchorMessage,
      personality,
      messageContent,
      extendedContextSettings,
      commandContext: context,
      isWeighInMode,
    });

    if (buildResult === null) {
      await channel.send(
        '❌ No conversation history found in this channel.\nStart a conversation first, or provide a message.'
      );
      return;
    }

    // 8. Submit job, poll for response, and track diagnostics + persistence
    await submitAndTrackJob({
      channel,
      personality,
      context: buildResult.context,
      characterSlug,
      isWeighInMode,
      personaId: buildResult.personaId,
      guildId: context.guildId,
      userMessageTime,
    });
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
 * Returns the message IDs of all sent chunks
 */
async function sendCharacterResponse(
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
