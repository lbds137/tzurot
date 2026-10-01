/**
 * InteractionCreate routing body, extracted from the service entrypoint
 * (`index.ts` logs in at module scope, so its listener body cannot be
 * imported into tests).
 *
 * The FIRST thing this router does with any interaction is the
 * foreign-application guard: nothing — not the DM warm, not the denylist
 * check, not the maintenance gate, not a command dispatch — may run for an
 * interaction that was not addressed to this application.
 */

import type { Interaction } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isForeignInteraction } from '../utils/foreignInteraction.js';
import { isInteractionDenied } from '../processors/interactionDenylistGate.js';
import { getThreadParentId } from '../utils/discordChannelTypes.js';
import { stampUserActivity } from '../utils/gatewayServiceCalls.js';
import { respondToInteractionDuringMaintenance } from '../utils/maintenanceResponses.js';
import { handleCommandWithContext } from './commandDispatch.js';
import type { createServices } from '../serviceFactory.js';
import type { CommandHandler } from './CommandHandler.js';

const logger = createLogger('interactionRouter');

/** Structural view of the collaborators the routing body needs. */
export interface InteractionRouterDeps {
  services: Pick<
    ReturnType<typeof createServices>,
    'dmCacheWarmer' | 'denylistCache' | 'maintenanceFlag'
  >;
  commandHandler: Pick<
    CommandHandler,
    | 'getCommand'
    | 'handleContextMenuCommand'
    | 'handleModalInteraction'
    | 'handleAutocomplete'
    | 'handleComponentInteraction'
  >;
}

/**
 * Route one delivered interaction: foreign-application guard, DM-cache warm,
 * denylist, maintenance gate, then the per-family dispatch branches.
 */
export async function routeInteraction(
  deps: InteractionRouterDeps,
  interaction: Interaction
): Promise<void> {
  // The guard precedes every ack — including the maintenance gate's reply
  // (pinned by the zero-ack tests in ./interactionRouter.test.ts).
  if (isForeignInteraction(interaction)) {
    return;
  }

  const { services, commandHandler } = deps;

  // Warm the DM channel cache for this user; see DMCacheWarmer.ts for why.
  services.dmCacheWarmer.warm(interaction.user);
  try {
    // Denylist check — applies to ALL interaction types (silent deny)
    if (
      isInteractionDenied(services.denylistCache, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        parentChannelId: getThreadParentId(interaction.channel),
      })
    ) {
      return;
    }

    // Maintenance gate — friendly ephemeral rejection instead of letting the
    // interaction reach the (503ing) gateway during a migration window. The
    // TTL-cached flag read stays well inside the 3-second ack budget; the
    // maintenance reply itself is the ack.
    if (await services.maintenanceFlag.isActive()) {
      await respondToInteractionDuringMaintenance(interaction);
      return;
    }

    if (interaction.isChatInputCommand()) {
      // Retention: pure-client commands (e.g. /help) render bot-side and never
      // reach the gateway, so stamp activity here for every chat-input command.
      // Fire-and-forget — the wrapper logs on failure and never throws; the
      // redundant stamp for gateway-reaching commands (which already stamp via
      // getOrCreateUser) is a harmless idempotent NOW-write. Not awaited: the
      // stamp must never delay or fail the 3-second ack path.
      void stampUserActivity(interaction.user.id).catch(() => {
        /* wrapper already logs; swallow so a rejection can't become unhandled */
      });

      // The dispatcher owns the whole chat-input path, including the
      // unknown-command reply when the lookup comes back empty.
      await handleCommandWithContext(
        interaction,
        commandHandler.getCommand(interaction.commandName)
      );
    } else if (interaction.isMessageContextMenuCommand()) {
      await commandHandler.handleContextMenuCommand(interaction);
    } else if (interaction.isModalSubmit()) {
      await commandHandler.handleModalInteraction(interaction);
    } else if (interaction.isAutocomplete()) {
      await commandHandler.handleAutocomplete(interaction);
    } else if (interaction.isStringSelectMenu() || interaction.isButton()) {
      // Route component interactions to their commands based on customId prefix
      await commandHandler.handleComponentInteraction(interaction);
    }
  } catch (error) {
    logger.error({ err: error }, 'Error in interaction handler');
  }
}
