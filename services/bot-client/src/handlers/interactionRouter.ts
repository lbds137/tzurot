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

import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Interaction,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isForeignInteraction } from '../utils/foreignInteraction.js';
import { INTERACTION_FAMILIES } from '../utils/interactionFamilies.js';
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

    // The family table is shared with the foreign-interaction classifier: the
    // dispatch keys on the same matched family the drop log reports.
    const family = INTERACTION_FAMILIES.find(f => f.guard(interaction));
    if (family === undefined) {
      return;
    }

    // The casts are the table's cost: TS cannot narrow through a table-driven
    // guard, and each case's matched label is what establishes the
    // interaction's type.
    switch (family.label) {
      case 'chat_input':
        await dispatchChatInput(commandHandler, interaction as ChatInputCommandInteraction);
        break;
      case 'message_context_menu':
        await commandHandler.handleContextMenuCommand(
          interaction as MessageContextMenuCommandInteraction
        );
        break;
      case 'modal_submit':
        await commandHandler.handleModalInteraction(interaction as ModalSubmitInteraction);
        break;
      case 'autocomplete':
        await commandHandler.handleAutocomplete(interaction as AutocompleteInteraction);
        break;
      case 'string_select_menu':
      case 'button':
        // Route component interactions to their commands based on customId prefix
        await commandHandler.handleComponentInteraction(
          interaction as StringSelectMenuInteraction | ButtonInteraction
        );
        break;
      default:
        // Classifier-only families (the entity select menus other than string
        // selects) are recognized in the drop log but have no dispatch here.
        break;
    }
  } catch (error) {
    logger.error({ err: error }, 'Error in interaction handler');
  }
}

/**
 * Dispatch one chat-input interaction: stamp activity for retention, then
 * hand the whole path to the dispatcher (which owns the unknown-command
 * reply when the command lookup comes back empty).
 */
async function dispatchChatInput(
  commandHandler: InteractionRouterDeps['commandHandler'],
  interaction: ChatInputCommandInteraction
): Promise<void> {
  // Retention: pure-client commands (e.g. /help) render bot-side and never
  // reach the gateway, so stamp activity here for every chat-input command.
  // Fire-and-forget — the wrapper logs on failure and never throws; the
  // redundant stamp for gateway-reaching commands (which already stamp via
  // getOrCreateUser) is a harmless idempotent NOW-write. Not awaited: the
  // stamp must never delay or fail the 3-second ack path.
  void stampUserActivity(interaction.user.id).catch(() => {
    /* wrapper already logs; swallow so a rejection can't become unhandled */
  });

  await handleCommandWithContext(interaction, commandHandler.getCommand(interaction.commandName));
}
