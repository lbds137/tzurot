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
  buildSectionModal,
  extractAndMergeSectionValues,
  getSessionManager,
  fetchOrCreateSession,
  parseDashboardCustomId,
  isDashboardInteraction,
} from '../../utils/dashboard/index.js';
import { DASHBOARD_MESSAGES } from '../../utils/dashboard/messages.js';
import { refreshDashboardUI } from '../../utils/dashboard/refreshHandler.js';
import {
  PRESET_DASHBOARD_CONFIG,
  type FlattenedPresetData,
  flattenPresetData,
  unflattenPresetData,
  buildPresetDashboardOptions,
} from './config.js';
import type { PresetData } from './types.js';
import { fetchPreset, updatePreset, updateGlobalPreset } from './api.js';
import { handleSeedModalSubmit } from './create.js';
import { PresetCustomIds } from '../../utils/customIds.js';
import { presetConfigValidator } from './presetValidation.js';
import { buildValidationEmbed, canProceed } from '../../utils/configValidation.js';

// Import button handlers from extracted module
import {
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

  // Extract and merge modal values with session data
  const extracted = extractAndMergeSectionValues(
    interaction,
    PRESET_DASHBOARD_CONFIG,
    sectionId,
    session?.data ?? {}
  );
  if (extracted === null) {
    return;
  }

  try {
    // Validate the merged configuration before saving
    const validationResult = presetConfigValidator.validate(
      extracted.merged as FlattenedPresetData
    );

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
    const updatePayload = unflattenPresetData(extracted.merged);

    // Determine if this is a global preset (from session data)
    const isGlobal = session?.data.isGlobal ?? false;

    // Update preset via appropriate API
    const updatedPreset = isGlobal
      ? await updateGlobalPreset(entityId, updatePayload)
      : await updatePreset(entityId, updatePayload, interaction.user.id);

    // Flatten the response for dashboard display
    const flattenedData = flattenPresetData(updatedPreset);

    // Preserve browseContext from existing session for back navigation
    if (session?.data.browseContext !== undefined) {
      flattenedData.browseContext = session.data.browseContext;
    }

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
    await refreshDashboardUI({
      interaction,
      entityId,
      data: flattenedData,
      dashboardConfig: PRESET_DASHBOARD_CONFIG,
      buildOptions: buildPresetDashboardOptions,
    });

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
    // Notify user of failure via followUp (since we deferred update)
    await interaction.followUp({
      content: '❌ Failed to update preset. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
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

    // Get current data from session or fetch from API
    const result = await fetchOrCreateSession<FlattenedPresetData, PresetData>({
      userId: interaction.user.id,
      entityType: 'preset',
      entityId,
      fetchFn: () => fetchPreset(entityId, interaction.user.id),
      transformFn: flattenPresetData,
      interaction,
    });
    if (!result.success) {
      await interaction.reply({
        content: DASHBOARD_MESSAGES.NOT_FOUND('Preset'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if user can edit this preset (uses canEdit for admin support)
    if (!result.data.canEdit) {
      await interaction.reply({
        content: DASHBOARD_MESSAGES.NO_PERMISSION('edit this preset'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Build and show section modal
    const modal = buildSectionModal(PRESET_DASHBOARD_CONFIG, section, entityId, result.data);
    await interaction.showModal(modal);
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

/** Dashboard-specific actions that this handler manages */
const DASHBOARD_ACTIONS = new Set([
  'menu',
  'modal',
  'seed',
  'close',
  'back',
  'refresh',
  'clone',
  'toggle-global',
  'delete',
  'confirm-delete',
  'cancel-delete',
]);

/**
 * Check if interaction is a preset dashboard interaction.
 * Only matches dashboard-specific actions, not all preset:: customIds.
 */
export function isPresetDashboardInteraction(customId: string): boolean {
  // Must start with preset::
  if (!isDashboardInteraction(customId, 'preset')) {
    return false;
  }

  // Parse to check the action
  const parsed = PresetCustomIds.parse(customId);
  if (parsed === null) {
    return false;
  }

  // Only return true for dashboard-specific actions
  return DASHBOARD_ACTIONS.has(parsed.action);
}
