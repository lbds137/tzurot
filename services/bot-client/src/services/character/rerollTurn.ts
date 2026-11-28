/**
 * Reroll turn: builds and submits the generation job that replaces an existing
 * character reply, then registers a `'reroll'` tracker slot so
 * `rerollResultHandler` delivers it by editing the old messages in place.
 *
 * Two shapes, chosen by the preflight:
 * - **Triggered** (the reply answered a message): anchors on the real trigger
 *   message fetched from Discord, with the trigger ROW's stored content as the
 *   turn text. The trigger is never re-persisted.
 * - **No trigger** (a weigh-in reply): the same synthetic anchor a weigh-in
 *   uses, plus the old reply's Discord ids so the live fetch does not hand the
 *   reply being replaced to the model.
 *
 * Both run as the persona owner (`resolveRerollTurnUser`) so billing and persona
 * resolution follow the turn owner even when the bot owner clicks. The shared
 * characterTurn helpers are reused as-is; this module only orchestrates.
 */

import type { MessageContextMenuCommandInteraction, User } from 'discord.js';
import { isTypingChannel, type TypingChannel } from '@tzurot/common-types/types/discord-types';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { z } from 'zod';
import type { RerollCheckResponseSchema } from '@tzurot/common-types/schemas/api/history';
import { clientsForUser } from '../../utils/gatewayClients.js';
import { redis } from '../../redis.js';
import { generate } from '../../utils/gatewayServiceCalls.js';
import { createContextMenuDeferredContext } from '../../utils/messageCharacterLookup.js';
import { getJobTracker, getMessageContextBuilder } from '../serviceRegistry.js';
import { buildExtendedContextSettings, resolveChatLlmConfig } from './chatConfigResolution.js';
import {
  WEIGH_IN_MESSAGE,
  adjustContextForWeighInMode,
  createSyntheticWeighInAnchor,
} from './characterTurn.js';
import { rememberRerollJob } from './rerollGuard.js';
import { resolveRerollTurnUser } from './rerollTurnUser.js';
import { runSlashChatGates } from './slashChatGates.js';

const logger = createLogger('reroll-turn');

export type RerollPreflight = z.infer<typeof RerollCheckResponseSchema>;

export const PERSONA_CHANGED_MESSAGE =
  "Your active persona for this character changed since this reply, so it can't be rerolled.";
export const TRIGGER_GONE_MESSAGE =
  "The message this replied to is gone, so this reply can't be rerolled.";
export const CANT_REROLL_MESSAGE = "I can't reroll this message anymore.";

export type RerollTurnOutcome =
  | { kind: 'submitted'; attemptId: string }
  /** `message` is null when a gate already replied to the interaction. */
  | { kind: 'refused'; message: string | null };

function refused(message: string | null): RerollTurnOutcome {
  return { kind: 'refused', message };
}

/**
 * Gates run for the clicker and, when different, for the turn owner the
 * generation is billed and attributed to (a bot owner clicking must not
 * generate as a denylisted owner). A refusal has already replied.
 */
async function passesGates(
  interaction: MessageContextMenuCommandInteraction,
  turnUser: User,
  personality: LoadedPersonality,
  channel: TypingChannel
): Promise<boolean> {
  const commandContext = createContextMenuDeferredContext(interaction);
  const gateActors =
    turnUser.id === interaction.user.id ? [interaction.user] : [interaction.user, turnUser];
  for (const actor of gateActors) {
    const blocked = await runSlashChatGates(
      { ...commandContext, user: actor },
      personality,
      channel,
      clientsForUser(actor).userClient
    );
    if (blocked) {
      return false;
    }
  }
  return true;
}

/**
 * Split the effective incognito flag into its two reruns: a stored non-incognito
 * row never takes the session path, whatever the caller inferred.
 */
function splitIncognito(
  preflight: RerollPreflight,
  incognito: boolean
): { sessionIncognito: boolean; anonymous: boolean } {
  const sessionIncognito =
    incognito && preflight.incognito && preflight.incognitoKind === 'session';
  return { sessionIncognito, anonymous: incognito && !sessionIncognito };
}

/**
 * Build and submit the reroll job. Throws on infrastructure failures (gateway,
 * Discord); the caller releases the guard and renders the failure.
 *
 * `attemptId` comes from the caller because it also owns the per-row guard.
 */
export async function submitRerollTurn(input: {
  interaction: MessageContextMenuCommandInteraction;
  preflight: RerollPreflight;
  personality: LoadedPersonality;
  attemptId: string;
  /** Effective incognito: the stored flag merged with the legacy-row inference. */
  incognito: boolean;
}): Promise<RerollTurnOutcome> {
  const { interaction, preflight, personality, attemptId, incognito } = input;
  const channel = interaction.channel;
  if (channel === null || !isTypingChannel(channel)) {
    return refused(CANT_REROLL_MESSAGE);
  }

  const turnUser = await resolveRerollTurnUser(interaction.client, preflight.ownerDiscordId);
  if (turnUser === null) {
    return refused(CANT_REROLL_MESSAGE);
  }

  if (!(await passesGates(interaction, turnUser, personality, channel))) {
    return refused(null);
  }

  // Config cascade (user/channel overrides) resolves for the turn owner.
  const resolvedConfig = await resolveChatLlmConfig(
    clientsForUser(turnUser).userClient,
    personality,
    channel.id
  );
  const extendedContext = buildExtendedContextSettings(resolvedConfig);
  const botUserId = interaction.client.user.id;
  const { trigger } = preflight;

  let anchor;
  if (trigger !== null) {
    try {
      anchor = await channel.messages.fetch(trigger.discordMessageId);
    } catch (err) {
      logger.warn({ err, rowId: preflight.rowId }, 'Reroll trigger message could not be fetched');
      return refused(TRIGGER_GONE_MESSAGE);
    }
  } else {
    anchor = createSyntheticWeighInAnchor(channel);
  }

  const isWeighInMode = trigger === null;
  // A personal turn that ran under the requester's `/memory incognito` session
  // keeps its persona and only skips the memory write; every other incognito
  // reply (an anonymous summon, or a row with no recorded kind) reruns
  // anonymous, the privacy-safe direction. A stored non-incognito row never
  // takes the session path, whatever the caller inferred.
  const { sessionIncognito, anonymous } = splitIncognito(preflight, incognito);
  const buildResult = await getMessageContextBuilder().buildContext(
    anchor,
    personality,
    isWeighInMode ? WEIGH_IN_MESSAGE : trigger.content,
    {
      extendedContext,
      botUserId,
      overrideUser: turnUser,
      ...(isWeighInMode
        ? { isWeighInMode: true, excludeDiscordMessageIds: preflight.discordMessageIds }
        : {}),
      incognito: anonymous,
    }
  );

  if (buildResult.personaId !== preflight.personaId) {
    return refused(PERSONA_CHANGED_MESSAGE);
  }

  const context = buildResult.context;
  // Weigh-in framing only for a reply that had no trigger; the incognito half
  // applies to both so a sticky-incognito reply stays incognito.
  adjustContextForWeighInMode(context, isWeighInMode, anonymous);
  if (!isWeighInMode) {
    context.triggerMessageId = anchor.id;
  }
  context.reroll = {
    rowId: preflight.rowId,
    attemptId,
    ...(trigger !== null ? { historyBefore: trigger.createdAt } : {}),
    ...(sessionIncognito ? { skipMemoryWrite: true } : {}),
  };

  const { jobId, requestId } = await generate(personality, context);
  // Tracked before anything else can throw: a running job without a tracker
  // slot has no result handler and leaves the guard held.
  getJobTracker().trackJob(jobId, {
    kind: 'reroll',
    channel,
    guildId: interaction.guildId,
    clientId: botUserId,
    userMessageTime: new Date(),
    personality,
    personaId: buildResult.personaId,
    interaction,
    rowId: preflight.rowId,
    attemptId,
    preflight,
  });

  await rememberRerollJob(redis, jobId, {
    rowId: preflight.rowId,
    attemptId,
    routeKey: preflight.discordMessageIds[0],
    actorId: interaction.user.id,
    keepMemoryIds: preflight.memoryPlan.kind === 'remove' ? preflight.memoryPlan.memoryIds : [],
  });

  logger.info(
    { jobId, requestId, rowId: preflight.rowId, triggered: trigger !== null },
    'Reroll job submitted'
  );

  return { kind: 'submitted', attemptId };
}
