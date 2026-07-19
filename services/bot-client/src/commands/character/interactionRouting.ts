/**
 * Character command interaction routing — select menus, buttons, and modals.
 *
 * Extracted from index.ts to keep the command file (which must hold the
 * SlashCommandBuilder inline for the command-types codegen's textual scan)
 * inside the max-lines cap. Declared as a `createComponentRouter` table;
 * the character EDIT dashboard is deliberately the `unrouted` fallback —
 * any customId this command owns that no surface claims belongs to it
 * (guard-free by design; the routing tests pin that fallback).
 */

import {
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
} from 'discord.js';
import { handleModalRetry, isModalRetryInteraction } from '../../utils/modal/retry.js';
import { createComponentRouter } from '../../utils/componentRouter.js';
import { buildCharacterSeedModal } from './create.js';
import { getConfig } from '@tzurot/common-types/config/config';
import {
  handleBrowsePagination,
  handleBrowseSelect,
  isCharacterBrowseInteraction,
  isCharacterBrowseSelectInteraction,
} from './browse.js';
import {
  handleCharacterSettingsSelectMenu,
  handleCharacterSettingsButton,
  handleCharacterSettingsModal,
  isCharacterSettingsInteraction,
} from './settings.js';
import {
  handleCharacterOverridesSelectMenu,
  handleCharacterOverridesButton,
  handleCharacterOverridesModal,
  isCharacterOverridesInteraction,
} from './overrides.js';
import {
  handleModalSubmit,
  handleSelectMenu as handleDashboardSelectMenu,
  handleButton as handleDashboardButton,
} from './dashboard.js';
import { aliasComponentRouter, isCharacterAliasInteraction } from './aliasBrowse.js';

const characterComponentRouter = createComponentRouter({
  routes: [
    // Browse: select and pagination are separate surfaces sharing one family
    // of prefixes; kind-scoped handlers keep them from claiming each other.
    {
      matches: isCharacterBrowseSelectInteraction,
      onSelect: interaction => handleBrowseSelect(interaction, getConfig()),
    },
    {
      matches: isCharacterBrowseInteraction,
      onButton: interaction => handleBrowsePagination(interaction, getConfig()),
    },
    // Alias browse surface (its own declarative sub-router)
    {
      matches: isCharacterAliasInteraction,
      onButton: interaction => aliasComponentRouter.handleButton(interaction),
      onSelect: interaction => aliasComponentRouter.handleSelectMenu(interaction),
    },
    // Try-again for a failed create-modal submission (prefilled reopen)
    {
      matches: customId => isModalRetryInteraction(customId, 'character'),
      onButton: interaction =>
        handleModalRetry(
          interaction,
          (kind, values) => (kind === 'seed' ? buildCharacterSeedModal(values) : null),
          '/character create'
        ),
    },
    {
      matches: isCharacterSettingsInteraction,
      onButton: handleCharacterSettingsButton,
      onSelect: handleCharacterSettingsSelectMenu,
      onModal: handleCharacterSettingsModal,
    },
    {
      matches: isCharacterOverridesInteraction,
      onButton: handleCharacterOverridesButton,
      onSelect: handleCharacterOverridesSelectMenu,
      onModal: handleCharacterOverridesModal,
    },
  ],
  // The edit dashboard is the fallback surface, not an error path. The
  // kind-narrowing casts are sound: dispatch hands each kind's handler the
  // interaction the same-kind entry point received.
  unrouted: async (interaction, kind) => {
    if (kind === 'button') {
      await handleDashboardButton(interaction as ButtonInteraction);
    } else if (kind === 'select') {
      await handleDashboardSelectMenu(interaction as StringSelectMenuInteraction);
    } else {
      await handleModalSubmit(interaction as ModalSubmitInteraction, getConfig());
    }
  },
});

/** Select-menu dispatch for character commands (browse, alias, dashboards). */
export const handleSelectMenu: (interaction: StringSelectMenuInteraction) => Promise<void> =
  characterComponentRouter.handleSelectMenu;

/** Button dispatch for character commands (browse, alias, retry, dashboards). */
export const handleButton: (interaction: ButtonInteraction) => Promise<void> =
  characterComponentRouter.handleButton;

/** Modal dispatch for character commands (settings, overrides, edit dashboard). */
export const handleCharacterModal: (interaction: ModalSubmitInteraction) => Promise<void> =
  characterComponentRouter.handleModal;
