/**
 * Preset Command - Dashboard Interaction Handlers
 *
 * Handles all dashboard interactions:
 * - Select menu for editing sections or triggering actions
 * - Button clicks (close, refresh, clone, delete, toggle-global)
 * - Modal submissions for section edits
 *
 * Button handlers are extracted to dashboardButtons.ts to keep file under 500 lines.
 */

import { MessageFlags } from 'discord.js';
import type {
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger, getConfig } from '@tzurot/common-types';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildSectionModal,
  extractModalValues,
  getSessionManager,
  parseDashboardCustomId,
  isDashboardInteraction,
} from '../../utils/dashboard/index.js';
import {
  PRESET_DASHBOARD_CONFIG,
  type FlattenedPresetData,
  flattenPresetData,
  unflattenPresetData,
} from './config.js';
import { fetchPreset, updatePreset, updateGlobalPreset } from './api.js';
import { handleSeedModalSubmit } from './create.js';
import { presetConfigValidator } from './presetValidation.js';
import { buildValidationEmbed, canProceed } from '../../utils/configValidation.js';

// Import button handlers from extracted module
import {
  buildPresetDashboardOptions,
  handleCloseButton,
  handleRefreshButton,
  handleToggleGlobalButton,
  handleDeleteButton,
  handleConfirmDeleteButton,
  handleCancelDeleteButton,
  handleCloneButton,
  handleBackButton,
} from './dashboardButtons.js';

const logger = createLogger('preset-dashboard');

/**
 * Refresh the dashboard UI with updated data (for modal submissions).
 */
async function refreshDashboardUI(
  interaction: ModalSubmitInteraction,
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
  const parsed = parseDashboardCustomId(customId);

  // Handle seed modal for new preset creation
  // Format: preset::seed
  if (parsed?.entityType === 'preset' && parsed.action === 'seed') {
    const config = getConfig();
    await handleSeedModalSubmit(interaction, config);
    return;
  }

  // Handle section edit modals
  // Format: preset::modal::{entityId}::{sectionId}
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
  if (section === undefined) {
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
    if (session !== null) {
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
    if (section === undefined) {
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
      if (preset === null) {
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
 * Handle button interactions for dashboard
 */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseDashboardCustomId(interaction.customId);
  if (parsed?.entityType !== 'preset' || parsed.entityId === undefined) {
    return;
  }

  const entityId = parsed.entityId;
  const action = parsed.action;

  switch (action) {
    case 'close':
      await handleCloseButton(interaction, entityId);
      break;
    case 'back':
      await handleBackButton(interaction, entityId);
      break;
    case 'refresh':
      await handleRefreshButton(interaction, entityId);
      break;
    case 'clone':
      await handleCloneButton(interaction, entityId);
      break;
    case 'toggle-global':
      await handleToggleGlobalButton(interaction, entityId);
      break;
    case 'delete':
      await handleDeleteButton(interaction, entityId);
      break;
    case 'confirm-delete':
      await handleConfirmDeleteButton(interaction, entityId);
      break;
    case 'cancel-delete':
      await handleCancelDeleteButton(interaction, entityId);
      break;
  }
}

/**
 * Check if interaction is a preset dashboard interaction
 */
export function isPresetDashboardInteraction(customId: string): boolean {
  return isDashboardInteraction(customId, 'preset');
}
