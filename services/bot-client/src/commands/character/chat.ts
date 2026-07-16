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

import { Collection, escapeMarkdown, type Message } from 'discord.js';
import { type EnvConfig } from '@tzurot/common-types/config/config';
import {
  characterChatOptions,
  characterRandomOptions,
  characterChimeInOptions,
} from '@tzurot/common-types/generated/commandOptions';
import { isTypingChannel, type TypingChannel } from '@tzurot/common-types/types/discord-types';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  getPersonalityLoader,
  getMessageContextBuilder,
  getConversationPersistence,
  getJobTracker,
} from '../../services/serviceRegistry.js';
import { resolveUserContext } from '../../services/contextBuilder/UserContextResolver.js';
import { clientsForUser, getServiceClient } from '../../utils/gatewayClients.js';
import {
  resolveChatLlmConfig,
  buildExtendedContextSettings,
  type ExtendedContextSettings,
} from '../../services/character/chatConfigResolution.js';
import { runSlashChatGates } from './slashChatGates.js';
import { generate } from '../../utils/gatewayServiceCalls.js';
import type { MessageContext } from '../../types.js';
import { resolveCharacterSlug, finalizeDeferredReply } from './randomPick.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';

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
 *
 * Exported so the synthetic-anchor test can assert against it rather than a
 * fragile string literal (a wording change then surfaces at the import, not as
 * a confusing value mismatch).
 */
export const WEIGH_IN_MESSAGE = '[Reply naturally to the context above]';

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
 * Weigh-in mode: a synthetic anchor carrying WEIGH_IN_MESSAGE (see below).
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
    // guildId/channelId are Discord.js prototype getters — absent on this plain
    // object — but buildBlockDeniedChecker (via MessageContextBuilder) reads them
    // to scope denylist lookups. Without them, guild- and channel-scoped blocks
    // would silently no-op on every weigh-in; populate them from the channel.
    guildId: 'guild' in channel ? channel.guild.id : null,
    channelId: channel.id,
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
}

/**
 * Send user message to Discord and save to conversation history.
 * Returns the Message object for context building and trigger tracking.
 */
async function sendAndPersistUserMessage(params: SendUserMessageParams): Promise<Message> {
  const { channel, displayName, message, personality, personaId, guildId } = params;

  const userMsg = await channel.send(`**${displayName}:** ${message}`);

  // Fire-and-forget persistence: Trade-off between responsiveness and guaranteed persistence.
  // If save fails (DB issues), the Discord message is still sent but won't be in history.
  // This matches the @mention pattern and prioritizes UX over perfect data consistency.
  //
  // Persist at the ECHO's own Discord createdAt so the stored row's timestamp equals its
  // snowflake time. The caller anchors the assistant row to echo.createdAt + 1ms, so the pair
  // stays ordered (user < assistant) AND consistent with the real Discord timeline — a
  // pre-send timestamp would land the pair ahead of the echo's snowflake and let the
  // extended-context merge (which sees the echo at its real snowflake time) invert them.
  void getConversationPersistence()
    .saveUserMessageFromFields({
      channelId: channel.id,
      guildId,
      discordMessageId: userMsg.id,
      personality,
      personaId,
      messageContent: message,
      timestamp: userMsg.createdAt,
    })
    .catch(err => {
      logger.warn({ err, messageId: userMsg.id }, 'Failed to save user message');
    });

  return userMsg;
}

/** Parameters for building chat context */
interface BuildChatContextParams {
  anchorMessage: Message;
  personality: LoadedPersonality;
  messageContent: string;
  extendedContextSettings: ExtendedContextSettings;
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
/**
 * Gate the turn (denylist + NSFW), then resolve the persona and config-cascade
 * prerequisites a chat turn needs. Returns `null` when a gate blocked the turn
 * (a reply has already been sent) so the caller can bail. Extracted from
 * {@link runCharacterTurn} to keep that handler within the line budget.
 */
async function resolveTurnPrereqs(
  context: DeferredCommandContext,
  personality: LoadedPersonality,
  channel: TypingChannel,
  discordDisplayName: string
): Promise<{
  userContext: Awaited<ReturnType<typeof resolveUserContext>>;
  displayName: string;
  extendedContextSettings: ExtendedContextSettings;
} | null> {
  // Gate parity with the message pipeline (PersonalityChatManager.runGates),
  // which the slash path used to skip. A blocked turn has already replied.
  const { userClient } = clientsForUser(context.user);
  if (await runSlashChatGates(context, personality, channel, userClient)) {
    return null;
  }

  // Resolve persona (id + display name) via routing-context — bot-client never
  // touches Prisma; the gateway runs provisioning + the persona cascade.
  const userContext = await resolveUserContext(context.user, personality, discordDisplayName, {
    serviceClient: getServiceClient(),
  });

  // Resolve the config cascade (user/channel overrides) and derive the
  // extended-context settings — the same resolution the message pipeline runs,
  // so /character chat honours overrides instead of silently using defaults.
  const resolvedConfig = await resolveChatLlmConfig(userClient, personality, channel.id);

  return {
    userContext,
    displayName: userContext.personaName ?? discordDisplayName,
    extendedContextSettings: buildExtendedContextSettings(resolvedConfig),
  };
}

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
      await context.editReply({
        content: renderSpec(
          CATALOG.error.notFound('Character', { name: escapeMarkdown(characterSlug) })
        ),
      });
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

    // 3-5. Gate the turn (denylist + NSFW), then resolve the persona + config
    //      cascade prerequisites. A blocked turn has already replied — bail.
    const prereqs = await resolveTurnPrereqs(context, personality, channel, discordDisplayName);
    if (prereqs === null) {
      return;
    }
    const { userContext, displayName, extendedContextSettings } = prereqs;

    // 5. Replace the deferred "thinking..." indicator before sending messages.
    await finalizeDeferredReply(context, personality, isRandomPick);

    // 6. Get a Discord Message object to use for context building with extended context.
    //    For a non-weigh-in turn this posts the echo, whose real Discord timestamp anchors
    //    conversation ordering (see userMessageTime below).
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
          }
    );

    if (!anchorResult.success) {
      await channel.send(anchorResult.error);
      return;
    }
    const anchorMessage = anchorResult.message;

    // Anchor conversation ordering to the echo's REAL Discord post time — NOT a pre-send
    // new Date(). The user row is persisted at the echo's createdAt (inside getAnchorMessage);
    // the assistant row derives echo.createdAt + 1ms. Sampling the time BEFORE the echo posted
    // stamped both rows ~80ms ahead of the echo's real snowflake, which the extended-context
    // merge — it sorts DB rows against bot-observed snapshot rows by their real snowflake time —
    // could then invert (assistant before user). Weigh-in posts no echo (synthetic anchor), so
    // it falls back to now(); there's no user row to order against there.
    const userMessageTime = isWeighInMode ? new Date() : anchorMessage.createdAt;

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
      await context.editReply({
        content: renderSpec(CATALOG.error.operationFailed('process the chat request')),
      });
    }
  } catch {
    const ch = context.channel;
    if (ch && 'send' in ch && typeof ch.send === 'function') {
      await ch.send(renderSpec(CATALOG.error.operationFailed('process the chat request')));
    }
  }
}
