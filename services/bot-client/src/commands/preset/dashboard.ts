/**
 * Preset Command - Dashboard Interaction Handlers
 *
 * Handles all dashboard interactions:
 * - Select menu for editing sections or triggering actions
 * - Button clicks (close, refresh)
 * - Modal submissions for section edits
 */

import { MessageFlags } from 'discord.js';
import type {
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildSectionModal,
  extractModalValues,
  getSessionManager,
  parseDashboardCustomId,
  isDashboardInteraction,
  type ActionButtonOptions,
} from '../../utils/dashboard/index.js';
import {
  PRESET_DASHBOARD_CONFIG,
  type FlattenedPresetData,
  flattenPresetData,
  unflattenPresetData,
} from './config.js';
import { fetchPreset, updatePreset, fetchGlobalPreset, updateGlobalPreset } from './api.js';
import { presetConfigValidator } from './presetValidation.js';
import { buildValidationEmbed, canProceed } from '../../utils/configValidation.js';

const logger = createLogger('preset-dashboard');

/**
 * Build dashboard button options including toggle-global for owned presets.
 * The toggle button only appears if the user owns the preset.
 */
function buildPresetDashboardOptions(data: FlattenedPresetData): ActionButtonOptions {
  return {
    showClose: true,
    showRefresh: true,
    toggleGlobal: {
      isGlobal: data.isGlobal,
      isOwned: data.isOwned,
    },
  };
}

/**
 * Refresh the dashboard UI with updated data.
 * Builds embed and components, then updates the interaction reply.
 * @param interaction - The deferred interaction to update
 * @param entityId - The preset ID
 * @param flattenedData - The flattened preset data for display
 */
async function refreshDashboardUI(
  interaction: ModalSubmitInteraction | ButtonInteraction,
  entityId: string,
  flattenedData: FlattenedPresetData
): Promise<void> {
  const embed = buildDashboardEmbed(PRESET_DASHBOARD_CONFIG, flattenedData);
  const components = buildDashboardComponents(
    PRESET_DASHBOARD_CONFIG,
    entityId,
    flattenedData,
    buildPresetDashboardOptions(flattenedData)
  );
  await interaction.editReply({ embeds: [embed], components });
}

/**
 * Handle modal submissions for preset editing
 */
export async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const customId = interaction.customId;

  // Handle section edit modals
  // Format: preset::modal::{entityId}::{sectionId}
  const parsed = parseDashboardCustomId(customId);
  if (
    parsed?.entityType === 'preset' &&
    parsed.action === 'modal' &&
    parsed.entityId !== undefined &&
    parsed.sectionId !== undefined
  ) {
    await handleSectionModalSubmit(interaction, parsed.entityId, parsed.sectionId);
    return;
  }

  logger.warn({ customId }, 'Unknown modal submission');
  await interaction.reply({
    content: '❌ Unknown form submission.',
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Handle section modal submission - update preset field
 */
async function handleSectionModalSubmit(
  interaction: ModalSubmitInteraction,
  entityId: string,
  sectionId: string
): Promise<void> {
  await interaction.deferUpdate();

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<FlattenedPresetData>(
    interaction.user.id,
    'preset',
    entityId
  );

  if (session === null) {
    logger.warn({ entityId, sectionId }, 'Session not found for modal submit');
  }

  // Find the section config
  const section = PRESET_DASHBOARD_CONFIG.sections.find(s => s.id === sectionId);
  if (!section) {
    logger.error({ sectionId }, 'Unknown section');
    return;
  }

  // Extract values from modal
  const values = extractModalValues(
    interaction,
    section.fields.map(f => f.id)
  );

  try {
    // Merge with existing session data to preserve other fields
    const currentData = session?.data ?? {};
    const mergedFlat = { ...currentData, ...values } as Partial<FlattenedPresetData>;

    // Validate the merged configuration before saving
    const validationResult = presetConfigValidator.validate(mergedFlat as FlattenedPresetData);

    // If validation has errors, show them and don't save
    if (!canProceed(validationResult)) {
      const errorEmbed = buildValidationEmbed(validationResult);
      if (errorEmbed !== null) {
        // Show validation errors as a follow-up message
        await interaction.followUp({
          embeds: [errorEmbed],
          flags: MessageFlags.Ephemeral,
        });
      }
      logger.warn(
        { entityId, sectionId, errors: validationResult.errors },
        'Preset save blocked by validation errors'
      );
      return;
    }

    // Convert to API format
    const updatePayload = unflattenPresetData(mergedFlat);

    // Determine if this is a global preset (from session data)
    const isGlobal = session?.data.isGlobal ?? false;

    // Update preset via appropriate API
    const updatedPreset = isGlobal
      ? await updateGlobalPreset(entityId, updatePayload)
      : await updatePreset(entityId, updatePayload, interaction.user.id);

    // Flatten the response for dashboard display
    const flattenedData = flattenPresetData(updatedPreset);

    // Update session
    if (session) {
      await sessionManager.update<FlattenedPresetData>(
        interaction.user.id,
        'preset',
        entityId,
        flattenedData
      );
    }

    // Refresh dashboard
    await refreshDashboardUI(interaction, entityId, flattenedData);

    // Show validation warnings after successful save (if any)
    if (validationResult.warnings.length > 0) {
      const warningEmbed = buildValidationEmbed(validationResult);
      if (warningEmbed !== null) {
        await interaction.followUp({
          embeds: [warningEmbed],
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    logger.info({ presetId: entityId, sectionId }, 'Preset section updated');
  } catch (error) {
    logger.error({ err: error, entityId, sectionId }, 'Failed to update preset section');
    // Dashboard will remain in its previous state since we deferred
  }
}

/**
 * Handle select menu interactions for dashboard
 */
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const parsed = parseDashboardCustomId(interaction.customId);
  if (parsed?.entityType !== 'preset' || parsed.entityId === undefined) {
    return;
  }

  const value = interaction.values[0];
  const entityId = parsed.entityId;

  // Handle section edit selection
  if (value.startsWith('edit-')) {
    const sectionId = value.replace('edit-', '');
    const section = PRESET_DASHBOARD_CONFIG.sections.find(s => s.id === sectionId);
    if (!section) {
      await interaction.reply({
        content: '❌ Unknown section.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get current data from session or fetch
    const sessionManager = getSessionManager();
    const session = await sessionManager.get<FlattenedPresetData>(
      interaction.user.id,
      'preset',
      entityId
    );
    let presetData: FlattenedPresetData;

    if (session !== null) {
      presetData = session.data;
    } else {
      // Fetch fresh data
      const preset = await fetchPreset(entityId, interaction.user.id);
      if (!preset) {
        await interaction.reply({
          content: '❌ Preset not found.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      presetData = flattenPresetData(preset);
      // Create new session
      await sessionManager.set({
        userId: interaction.user.id,
        entityType: 'preset',
        entityId,
        data: presetData,
        messageId: interaction.message.id,
        channelId: interaction.channelId,
      });
    }

    // Check if user can edit this preset (uses canEdit for admin support)
    if (!presetData.canEdit) {
      await interaction.reply({
        content: '❌ You do not have permission to edit this preset.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Build and show section modal
    const modal = buildSectionModal(PRESET_DASHBOARD_CONFIG, section, entityId, presetData);
    await interaction.showModal(modal);
    return;
  }
}

/**
 * Handle close button - delete session and close dashboard.
 * @param interaction - The button interaction
 * @param entityId - The preset ID to close
 */
async function handleCloseButton(interaction: ButtonInteraction, entityId: string): Promise<void> {
  const sessionManager = getSessionManager();
  await sessionManager.delete(interaction.user.id, 'preset', entityId);

  await interaction.update({
    content: '✅ Dashboard closed.',
    embeds: [],
    components: [],
  });
}

/**
 * Handle refresh button - fetch fresh data and update dashboard.
 * Detects whether the preset is global to use the appropriate fetch API.
 * @param interaction - The button interaction
 * @param entityId - The preset ID to refresh
 */
async function handleRefreshButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  await interaction.deferUpdate();

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<FlattenedPresetData>(
    interaction.user.id,
    'preset',
    entityId
  );
  const isGlobal = session?.data.isGlobal ?? false;

  const preset = isGlobal
    ? await fetchGlobalPreset(entityId)
    : await fetchPreset(entityId, interaction.user.id);

  if (!preset) {
    await interaction.editReply({
      content: '❌ Preset not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const flattenedData = flattenPresetData(preset);

  await sessionManager.set({
    userId: interaction.user.id,
    entityType: 'preset',
    entityId,
    data: flattenedData,
    messageId: interaction.message.id,
    channelId: interaction.channelId,
  });

  await refreshDashboardUI(interaction, entityId, flattenedData);
}

/**
 * Handle toggle-global button - toggle preset visibility.
 * Only the owner of a preset can toggle its global status.
 * @param interaction - The button interaction
 * @param entityId - The preset ID to toggle
 */
async function handleToggleGlobalButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  await interaction.deferUpdate();

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<FlattenedPresetData>(
    interaction.user.id,
    'preset',
    entityId
  );

  if (!session) {
    await interaction.editReply({
      content: '❌ Session expired. Please reopen the dashboard.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (!session.data.isOwned) {
    await interaction.followUp({
      content: '❌ You can only toggle global status for presets you own.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const newIsGlobal = !session.data.isGlobal;
    const updatedPreset = await updatePreset(
      entityId,
      { isGlobal: newIsGlobal },
      interaction.user.id
    );

    const flattenedData = flattenPresetData(updatedPreset);

    await sessionManager.update<FlattenedPresetData>(
      interaction.user.id,
      'preset',
      entityId,
      flattenedData
    );

    await refreshDashboardUI(interaction, entityId, flattenedData);

    const statusText = newIsGlobal ? 'global (visible to everyone)' : 'private (only you)';
    logger.info({ presetId: entityId, newIsGlobal }, `Preset visibility changed to ${statusText}`);
  } catch (error) {
    logger.error({ err: error, entityId }, 'Failed to toggle preset global status');
    await interaction.followUp({
      content: '❌ Failed to update preset visibility. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle button interactions for dashboard
 */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseDashboardCustomId(interaction.customId);
  if (parsed?.entityType !== 'preset' || parsed.entityId === undefined) {
    return;
  }

  const entityId = parsed.entityId;
  const action = parsed.action;

  if (action === 'close') {
    await handleCloseButton(interaction, entityId);
  } else if (action === 'refresh') {
    await handleRefreshButton(interaction, entityId);
  } else if (action === 'toggle-global') {
    await handleToggleGlobalButton(interaction, entityId);
  }
}

/**
 * Check if interaction is a preset dashboard interaction
 */
export function isPresetDashboardInteraction(customId: string): boolean {
  return isDashboardInteraction(customId, 'preset');
}
