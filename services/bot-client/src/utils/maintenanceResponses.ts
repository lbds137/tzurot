/**
 * Maintenance-window user responses.
 *
 * When the shared MaintenanceFlag is active (destructive-migration windows —
 * see `pnpm ops maintenance`), bot-client rejects traffic at its two front
 * doors with a FRIENDLY signal instead of letting requests reach the 503ing
 * gateway and surface as generic errors:
 *
 * - Interactions (slash/modal/component) → ephemeral text reply.
 * - Autocomplete → empty choice list (the only response shape it supports).
 * - DMs → text reply (1:1 context, no spam concern).
 * - Guild messages that @mention the bot (incl. reply-with-ping) → 🔧 reaction
 *   (a text reply per message would spam active channels).
 * - Everything else (name-prefix summons, active channels) → silent drop.
 *   Detecting those requires the personality lookup — a gateway/DB round-trip,
 *   which is exactly what's unavailable during the window. A few minutes of
 *   silence is the accepted trade; the alternative is the error embed.
 */

import { MessageFlags, type Interaction, type Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('maintenanceResponses');

/** User-facing maintenance notice (bot-client adds the emoji; the gateway's JSON stays plain). */
export const MAINTENANCE_USER_MESSAGE =
  '🔧 Tzurot is down for a quick maintenance window — back in a few minutes!';

/** Reaction used to acknowledge guild mentions during the window. */
export const MAINTENANCE_REACTION = '🔧';

/**
 * Respond to any interaction during maintenance. The ephemeral reply doubles
 * as the Discord ack, so this satisfies the 3-second window on its own.
 */
export async function respondToInteractionDuringMaintenance(
  interaction: Interaction
): Promise<void> {
  try {
    if (interaction.isAutocomplete()) {
      await interaction.respond([]);
      return;
    }
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: MAINTENANCE_USER_MESSAGE,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    logger.debug({ err: error }, 'Failed to send maintenance interaction response');
  }
}

/**
 * Acknowledge a message during maintenance: DM → text reply; guild @mention
 * (incl. reply-with-ping, via `message.mentions`) → 🔧 reaction; else silent.
 * Bot/webhook authors are never acknowledged (proxy traffic isn't a person
 * waiting on a response).
 */
export async function acknowledgeMessageDuringMaintenance(message: Message): Promise<void> {
  if (message.author.bot) {
    return;
  }
  try {
    if (message.guild === null) {
      await message.reply(MAINTENANCE_USER_MESSAGE);
      return;
    }
    const clientUser = message.client.user;
    if (clientUser !== null && message.mentions.has(clientUser)) {
      await message.react(MAINTENANCE_REACTION);
    }
  } catch (error) {
    // Missing perms (reactions off, DMs closed) must not escalate a
    // maintenance acknowledgement into an error log storm.
    logger.debug({ err: error, messageId: message.id }, 'Failed to acknowledge maintenance');
  }
}
