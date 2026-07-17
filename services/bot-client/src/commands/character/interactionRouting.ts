/**
 * Character command interaction routing — select menus, buttons, and modals.
 *
 * Extracted from index.ts to keep the command file (which must hold the
 * SlashCommandBuilder inline for the command-types codegen's textual scan)
 * inside the max-lines cap. Pure customId-prefix dispatch: browse →
 * settings dashboard → overrides dashboard → edit dashboard fallback.
 */

import {
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
} from 'discord.js';
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

/**
 * Handle select menu interactions for character commands
 * Routes to browse select, settings dashboard, or edit dashboard based on customId prefix
 */
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const config = getConfig();

  // Check if it's a browse select interaction (user selected character from browse list)
  if (isCharacterBrowseSelectInteraction(interaction.customId)) {
    await handleBrowseSelect(interaction, config);
    return;
  }

  // Check if it's a settings dashboard interaction
  if (isCharacterSettingsInteraction(interaction.customId)) {
    await handleCharacterSettingsSelectMenu(interaction);
    return;
  }

  // Check if it's an overrides dashboard interaction
  if (isCharacterOverridesInteraction(interaction.customId)) {
    await handleCharacterOverridesSelectMenu(interaction);
    return;
  }

  // Otherwise route to character edit dashboard
  await handleDashboardSelectMenu(interaction);
}

/**
 * Handle button interactions for character commands
 * Routes to browse pagination, settings dashboard, or edit dashboard based on customId
 */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const config = getConfig();

  // Handle browse pagination
  if (isCharacterBrowseInteraction(interaction.customId)) {
    await handleBrowsePagination(interaction, config);
    return;
  }

  // Check if it's a settings dashboard interaction
  if (isCharacterSettingsInteraction(interaction.customId)) {
    await handleCharacterSettingsButton(interaction);
    return;
  }

  // Check if it's an overrides dashboard interaction
  if (isCharacterOverridesInteraction(interaction.customId)) {
    await handleCharacterOverridesButton(interaction);
    return;
  }

  // Otherwise route to character edit dashboard
  await handleDashboardButton(interaction);
}

/**
 * Handle modal interactions for character commands
 * Routes to settings dashboard or edit dashboard based on customId prefix
 */
export async function handleCharacterModal(interaction: ModalSubmitInteraction): Promise<void> {
  const config = getConfig();

  // Check if it's a settings dashboard modal
  if (isCharacterSettingsInteraction(interaction.customId)) {
    await handleCharacterSettingsModal(interaction);
    return;
  }

  // Check if it's an overrides dashboard modal
  if (isCharacterOverridesInteraction(interaction.customId)) {
    await handleCharacterOverridesModal(interaction);
    return;
  }

  // Otherwise route to character edit dashboard
  await handleModalSubmit(interaction, config);
}
