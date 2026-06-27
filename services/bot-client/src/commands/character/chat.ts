/**
 * Character Chat Command Handler
 *
 * Allows users to chat with a character using a slash command.
 * Push-based delivery: submits the job, registers a slash-context with
 * JobTracker, and returns. MessageHandler.handleSlashJobResult delivers
 * the response when the ResultsListener stream emits the result. This
 * matches the @mention path's delivery model and removes the 2-min
 * polling cap that was orphaning long-running free-model jobs.
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
 *
 * DMs are supported: a `/character chat` invocation in a DM is delivered
 * via DMChannel.send (the same surface @mention chat in DMs uses).
 */

import { Collection, type Message } from 'discord.js';
import {
  createLogger,
  isTypingChannel,
  MESSAGE_LIMITS,
  characterChatOptions,
  characterRandomOptions,
  characterChimeInOptions,
  type TypingChannel,
  type EnvConfig,
  type LoadedPersonality,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  getPersonalityLoader,
  getMessageContextBuilder,
  getConversationPersistence,
  getJobTracker,
} from '../../services/serviceRegistry.js';
import { resolveUserContext } from '../../services/contextBuilder/UserContextResolver.js';
import { getServiceClient } from '../../utils/gatewayClients.js';
import { generate } from '../../utils/gatewayServiceCalls.js';
import type { MessageContext } from '../../types.js';
import { resolveCharacterSlug, finalizeDeferredReply } from './randomPick.js';

const logger = createLogger('character-chat');

/**
 * Validate that the channel supports the push-delivery surface
 * (TypingChannel covers GuildText, DM, NewsChannel, PublicThread,
 * PrivateThread). Returns the narrowed channel or null.
 */
function validateChannel(context: DeferredCommandContext): TypingChannel | null {
  const channel = context.channel;
  if (!channel || !isTypingChannel(channel)) {
    return null;
  }
  return channel;
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
 * Weigh-in mode: a synthetic, content-less anchor (see below).
 */
async function getAnchorMessage(
  channel: TypingChannel,
  isWeighInMode: boolean,
  sendUserMessageParams: SendUserMessageParams | null
): Promise<GetAnchorMessageResult> {
  if (!isWeighInMode && sendUserMessageParams !== null) {
    const message = await sendAndPersistUserMessage(sendUserMessageParams);
    return { success: true, message };
  }

  // Weigh-in mode: the current turn carries NO real user message — the
  // personality is asked to read the room and respond. Anchor on a synthetic,
  // content-less message carrying only WEIGH_IN_MESSAGE.
  //
  // We must NOT anchor on the real latest channel message: the thin-envelope
  // assembler re-derives the current turn from anchor.content + the anchor's
  // voice transcript (RawEnvelopeBuilder's rawMessageContent / rawRoutingTranscript),
  // so a real anchor leaks the latest message's text AND transcribes its voice
  // attachment into the current turn — even when that message is from a
  // different character. The latest message still reaches the prompt as
  // HISTORY: the extended-context fetch omits `before` in weigh-in
  // (MessageContextBuilder), so it includes the most recent N messages (the
  // anchor's id is unused) where voice transcripts get the proper
  // <voice_transcripts> wrapper.
  return { success: true, message: createSyntheticWeighInAnchor(channel) };
}

/**
 * Build a field-only synthetic `Message` — the anchor for EVERY weigh-in turn,
 * not just empty channels.
 *
 * The anchor's `content` is WEIGH_IN_MESSAGE: the thin-envelope assembler
 * re-derives the current turn from anchor.content, so this is what becomes the
 * "read the room" user turn. We deliberately do NOT anchor on the real latest
 * channel message — that would leak its text + voice transcript into the current
 * turn (see getAnchorMessage). The real recent messages arrive as HISTORY via
 * the extended-context fetch instead.
 *
 * buildContext only READS from the anchor — it never mutates it or calls Discord
 * API methods (no `.fetch`/`.reply`/`.react`). It DOES call Collection accessors
 * (`.some`/`.size`/`.values`) on the field VALUES (`attachments`, `mentions.users`),
 * so those carry real `Collection`s, not bare objects. For weigh-in the author/
 * member are overridden and the id is unused, so nothing real beyond the channel
 * handle is needed. MessageContextBuilder's field-only-anchor test runs
 * buildContext through this exact shape — if a field this synthetic omits starts
 * being read (as `mentions` once was), that test fails loudly rather than
 * crashing at runtime.
 */
function createSyntheticWeighInAnchor(channel: TypingChannel): Message {
  return {
    // Never sent to Discord (weigh-in omits `before`, so the id is unused); a
    // readable placeholder keeps any incidental debug log clear rather than ''.
    id: 'synthetic-weigh-in-anchor',
    channel,
    client: channel.client,
    guild: 'guild' in channel ? channel.guild : null,
    // May be null pre-login, but that's safe: the weigh-in call passes
    // `overrideUser`, so MessageContextBuilder resolves the user identity from
    // that — never from this anchor's `author`.
    author: channel.client?.user ?? null,
    member: null,
    // The read-the-room instruction IS the weigh-in current turn — the worker
    // builds the turn from anchor.content. No real channel message is used.
    content: WEIGH_IN_MESSAGE,
    attachments: new Collection(),
    embeds: [],
    messageSnapshots: new Collection(),
    reference: null,
    // RawEnvelopeBuilder reads `mentions.users` (.size / .values()); the
    // synthetic anchor has no mentions, but the field must exist or the read throws.
    mentions: { users: new Collection() },
  } as unknown as Message;
}

/**
 * Apply the two orthogonal summon concerns to the built context:
 * - **Framing** (`isWeighInMode`): the prompt is a read-the-room system
 *   instruction, not a user message. A weigh-in is NOT gated on having prior
 *   conversation — it just generates (an empty/quiet room is a valid thing to
 *   read); the only structural precondition is an anchor message to build from
 *   (see getAnchorMessage).
 * - **Anonymity** (`incognito`): drop the persona attribution (no `<from>` tag)
 *   so ai-worker skips persona + LTM read/write + epoch. A personal summon
 *   (`incognito=false`) keeps its persona while still using weigh-in framing.
 */
function adjustContextForWeighInMode(
  context: MessageContext,
  isWeighInMode: boolean,
  incognito: boolean
): void {
  if (isWeighInMode) {
    context.isWeighIn = true;
  }
  if (incognito) {
    context.activePersonaId = undefined;
    context.activePersonaName = undefined;
  }
  context.incognito = incognito;
}

/**
 * Parameters for sending user message to Discord
 */
interface SendUserMessageParams {
  channel: TypingChannel;
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
      logger.warn({ err, messageId: userMsg.id }, 'Failed to save user message');
    });

  return userMsg;
}

/**
 * Build extended-context settings from a personality.
 * Pulls the `?? default` coalescing out of the main handler so complexity stays bounded.
 */
function buildExtendedContextSettings(personality: LoadedPersonality): {
  maxMessages: number;
  maxAge: number | null;
  maxImages: number;
  sources: {
    maxMessages: 'personality';
    maxAge: 'personality';
    maxImages: 'personality';
  };
} {
  return {
    maxMessages: personality.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
    maxAge: personality.maxAge ?? null,
    maxImages: personality.maxImages ?? 10,
    sources: {
      maxMessages: 'personality',
      maxAge: 'personality',
      maxImages: 'personality',
    },
  };
}

/** Parameters for building chat context */
interface BuildChatContextParams {
  anchorMessage: Message;
  personality: LoadedPersonality;
  messageContent: string;
  extendedContextSettings: {
    maxMessages: number;
    maxAge: number | null;
    maxImages: number;
    sources: {
      maxMessages: 'personality' | 'user-personality' | 'user-default';
      maxAge: 'personality' | 'user-personality' | 'user-default';
      maxImages: 'personality' | 'user-personality' | 'user-default';
    };
  };
  commandContext: DeferredCommandContext;
  isWeighInMode: boolean;
  /** Anonymity flag: skip persona + memory + epoch (the read-the-room framing
   *  stays under isWeighInMode). Defaults are resolved by the caller. */
  incognito: boolean;
}

/**
 * Build context for chat command with proper user identity override.
 */
async function buildChatContext(
  params: BuildChatContextParams
): Promise<{ context: MessageContext; personaId: string }> {
  const {
    anchorMessage,
    personality,
    messageContent,
    extendedContextSettings,
    commandContext,
    isWeighInMode,
    incognito,
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
      isWeighInMode,
      incognito,
    }
  );

  // Adjust context: weigh-in framing under isWeighInMode; anonymity (persona
  // clear + incognito flag) under incognito. A weigh-in is no longer gated on
  // non-empty history — it just generates.
  adjustContextForWeighInMode(buildResult.context, isWeighInMode, incognito);

  // Set trigger message ID for diagnostic tracking (chat mode only)
  if (!isWeighInMode) {
    buildResult.context.triggerMessageId = anchorMessage.id;
  }

  return { context: buildResult.context, personaId: buildResult.personaId };
}

/**
 * Submit the job and register a slash-context with JobTracker. The result
 * arrives asynchronously via `MessageHandler.handleSlashJobResult` —
 * this function returns as soon as the job is in flight.
 */
interface SubmitJobParams {
  channel: TypingChannel;
  personality: LoadedPersonality;
  context: MessageContext;
  characterSlug: string;
  isWeighInMode: boolean;
  personaId: string;
  guildId: string | null;
  clientId: string | undefined;
  userMessageTime: Date;
  userId: string;
}

async function submitAndTrackJob(params: SubmitJobParams): Promise<void> {
  const {
    channel,
    personality,
    context,
    characterSlug,
    isWeighInMode,
    personaId,
    guildId,
    clientId,
    userMessageTime,
    userId,
  } = params;

  const { jobId, requestId } = await generate(personality, context);
  logger.info({ jobId, requestId, characterSlug, isWeighInMode }, 'Slash job submitted');

  getJobTracker().trackJob(jobId, {
    kind: 'slash',
    channel,
    guildId,
    clientId,
    userMessageTime,
    personality,
    personaId,
    characterSlug,
    isWeighInMode,
    userId,
  });
}

/**
 * Read the random-pick filter flags out of the typed slash options.
 *
 * Extracted from `handleChat` so the two `?? false` defaults don't push the
 * caller over the cyclomatic-complexity cap; the per-flag default expansion
 * lives here where it's the function's only concern. Each filter is
 * independent — see `ResolveCharacterSlugOptions` for the AND-composition.
 */
function readRandomPickFilters(options: ReturnType<typeof characterRandomOptions>): {
  excludePrivate: boolean;
  onlyMine: boolean;
} {
  return {
    excludePrivate: options['exclude-private']() ?? false,
    onlyMine: options['only-mine']() ?? false,
  };
}

/**
 * Shared core for the three character-turn commands (`chat`, `random`,
 * `chime-in`). They differ only in how they resolve their inputs:
 *
 * - **`/character chat`**: a named character + a required message → chat mode.
 * - **`/character random`**: `characterArg=null` forces a random pick; with a
 *   message it's a chat, with no message it's a weigh-in ("read the room").
 * - **`/character chime-in`**: a named character + no message → weigh-in mode
 *   (anonymous, no persona, no LTM, no STM-reset epoch).
 *
 * Weigh-in is derived purely from `message` being absent/empty, so all three
 * funnel through the same delivery path. Uses MessageContextBuilder for parity
 * with @mentions (context epoch, guild member info, user timezone).
 */
async function runCharacterTurn(
  context: DeferredCommandContext,
  _config: EnvConfig,
  params: {
    /** Provided character slug, or null to force a random pick. */
    characterArg: string | null;
    /** User message, or null/empty for weigh-in mode. */
    message: string | null;
    /** Random-pick filters — only meaningful when characterArg is null. */
    filters: { excludePrivate: boolean; onlyMine: boolean };
    /**
     * The `incognito` option from chime-in/random (null when unset). null →
     * default to weigh-in mode (no-message summons are anonymous, with-message
     * are personal); explicit true/false overrides. Absent for /character chat.
     */
    incognitoOption?: boolean | null;
  }
): Promise<void> {
  const { characterArg, message, filters, incognitoOption } = params;
  const userId = context.user.id;
  const isWeighInMode = message === null || message.trim().length === 0;
  // Anonymity flag (separate from the read-the-room framing). Defaults to
  // isWeighInMode so existing behavior is preserved; the option overrides it.
  const incognito = incognitoOption ?? isWeighInMode;
  const discordDisplayName = context.member?.displayName ?? context.user.displayName;

  // Resolve the character slug (either provided or a random pick).
  const resolved = await resolveCharacterSlug(characterArg, context, filters);
  if (resolved.kind === 'error') {
    await context.editReply({ content: resolved.message });
    return;
  }
  const characterSlug = resolved.slug;
  const isRandomPick = resolved.randomPick;

  logger.info(
    { characterSlug, userId, messageLength: message?.length ?? 0, isWeighInMode, isRandomPick },
    'Processing chat request'
  );

  try {
    // 1. Load and validate personality. STRICT: a gateway failure throws (caught
    // below → "try again"); `null` means the character genuinely doesn't exist /
    // isn't accessible. A transient failure must not surface as a false "not found".
    const personality = await getPersonalityLoader().loadPersonalityStrict(characterSlug, userId);
    if (!personality) {
      await context.editReply({ content: `❌ Character "${characterSlug}" not found.` });
      return;
    }

    // 2. Validate channel supports push delivery (covers Guild text/threads + DMs)
    const channel = validateChannel(context);
    if (!channel) {
      await context.editReply({
        content:
          'This channel type is not supported. Try a text channel, thread, DM, or announcement channel.',
      });
      return;
    }

    // 3. Resolve persona (id + display name) via routing-context. bot-client
    //    never touches Prisma — the gateway runs provisioning + the persona
    //    cascade server-side and returns the resolved id + display name.
    const userContext = await resolveUserContext(context.user, personality, discordDisplayName, {
      serviceClient: getServiceClient(),
    });
    const displayName = userContext.personaName ?? discordDisplayName;

    // 4. Build extended context settings from personality
    const extendedContextSettings = buildExtendedContextSettings(personality);

    // 5. Replace the deferred "thinking..." indicator before sending messages.
    await finalizeDeferredReply(context, personality, isRandomPick);

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
            personaId: userContext.personaId,
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
      incognito,
    });

    // 8. Submit job + register slash context. Result arrives via
    // handleSlashJobResult.
    await submitAndTrackJob({
      channel,
      personality,
      context: buildResult.context,
      characterSlug,
      isWeighInMode,
      personaId: buildResult.personaId,
      guildId: context.guildId,
      clientId: context.interaction.client.user?.id,
      userMessageTime,
      userId,
    });
  } catch (error) {
    logger.error({ err: error, characterSlug }, 'Error processing chat');
    await handleChatError(context);
  }
}

/**
 * `/character chat` — chat one-on-one with a named character. Both args are
 * required (the message-required invariant is what makes Discord block the old
 * "omit message = weigh-in" ambiguity at the UI level).
 */
export async function handleChat(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const options = characterChatOptions(context.interaction);
  await runCharacterTurn(context, config, {
    characterArg: options.character(),
    message: options.message(),
    filters: { excludePrivate: false, onlyMine: false },
  });
}

/**
 * `/character random` — pick a random accessible character. With a message it's
 * a chat; with no message the random pick reads the room (weigh-in).
 */
export async function handleRandom(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const options = characterRandomOptions(context.interaction);
  await runCharacterTurn(context, config, {
    characterArg: null, // null forces the random pick in resolveCharacterSlug
    message: options.message(),
    filters: readRandomPickFilters(options),
    incognitoOption: options.incognito(),
  });
}

/**
 * `/character chime-in` — have a named character react to the recent
 * conversation with no message from the invoker (weigh-in semantics: anonymous,
 * no persona attachment, no LTM read/write, no STM-reset epoch).
 */
export async function handleChimeIn(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const options = characterChimeInOptions(context.interaction);
  await runCharacterTurn(context, config, {
    characterArg: options.character(),
    message: null, // no message → weigh-in mode
    filters: { excludePrivate: false, onlyMine: false },
    incognitoOption: options.incognito(),
  });
}

/**
 * Handle errors in chat command by sending error message to user
 */
async function handleChatError(context: DeferredCommandContext): Promise<void> {
  try {
    const { interaction } = context;
    if (interaction.replied || interaction.deferred) {
      await context.editReply({ content: '❌ Sorry, something went wrong. Please try again.' });
    }
  } catch {
    const ch = context.channel;
    if (ch && 'send' in ch && typeof ch.send === 'function') {
      await ch.send('❌ Sorry, something went wrong. Please try again.');
    }
  }
}
