/**
 * Preset Command - Dashboard Button Handlers
 *
 * Extracted from dashboard.ts to keep file under 500 lines.
 * Handles all button interactions:
 * - Close, Refresh, Clone
 * - Toggle Global visibility
 * - Delete confirmation flow
 */

import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import { createLogger, getConfig } from '@tzurot/common-types';
import { buildDeleteConfirmation } from '../../utils/dashboard/deleteConfirmation.js';
import { handleDashboardClose } from '../../utils/dashboard/closeHandler.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
  type ActionButtonOptions,
} from '../../utils/dashboard/index.js';
import { DASHBOARD_MESSAGES, formatSessionExpiredMessage } from '../../utils/dashboard/messages.js';
import {
  PRESET_DASHBOARD_CONFIG,
  type FlattenedPresetData,
  flattenPresetData,
  unflattenPresetData,
} from './config.js';
import { fetchPreset, updatePreset, fetchGlobalPreset, createPreset } from './api.js';
import { buildBrowseResponse, type PresetBrowseFilter } from './browse.js';

const logger = createLogger('preset-dashboard-buttons');

/**
 * Pattern to match a trailing (Copy) or (Copy N) suffix.
 * Defined at module scope to avoid regex recompilation on each call.
 * Group 1 captures the optional number for extraction.
 */
const COPY_SUFFIX_PATTERN = /\s*\(Copy(?:\s+(\d+))?\)\s*$/i;

/**
 * Generate a cloned name by stripping all (Copy N) suffixes and adding a new one.
 * Finds the maximum copy number among all suffixes and increments it.
 *
 * Examples:
 * - "Preset" → "Preset (Copy)"
 * - "Preset (Copy)" → "Preset (Copy 2)"
 * - "Preset (Copy 2)" → "Preset (Copy 3)"
 * - "Preset (Copy) (Copy)" → "Preset (Copy 2)" (max of 1,1 is 1, so next is 2)
 * - "Preset (Copy 5) (Copy)" → "Preset (Copy 6)" (max of 5,1 is 5, so next is 6)
 *
 * @param originalName - The original preset name
 * @returns A new name with appropriate (Copy N) suffix
 */
export function generateClonedName(originalName: string): string {
  // Iteratively strip (Copy N) suffixes and track the highest number
  let baseName = originalName;
  let maxNum = 0;
  let hadSuffix = false;

  let match: RegExpExecArray | null;
  while ((match = COPY_SUFFIX_PATTERN.exec(baseName)) !== null) {
    hadSuffix = true;
    // match[1] is the capture group for the number (undefined if just "(Copy)")
    const num = match[1] !== undefined ? parseInt(match[1], 10) : 1;
    maxNum = Math.max(maxNum, num);
    // Strip this suffix
    baseName = baseName.slice(0, match.index);
  }

  baseName = baseName.trim();

  if (!hadSuffix) {
    return `${originalName} (Copy)`;
  }

  return `${baseName} (Copy ${maxNum + 1})`;
}

/**
 * Build dashboard button options including toggle-global and delete for owned presets.
 * Shows back button when opened from browse, close button when opened directly.
 */
export function buildPresetDashboardOptions(data: FlattenedPresetData): ActionButtonOptions {
  const hasBrowseContext = data.browseContext !== undefined;
  return {
    showBack: hasBrowseContext,
    showClose: !hasBrowseContext,
    showRefresh: true,
    showClone: true,
    showDelete: data.isOwned,
    toggleGlobal: {
      isGlobal: data.isGlobal,
      isOwned: data.isOwned,
    },
  };
}

/**
 * Refresh the dashboard UI with updated data.
 */
export async function refreshDashboardUI(
  interaction: ButtonInteraction,
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
 * Handle close button using shared handler
 */
export async function handleCloseButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  await handleDashboardClose(interaction, 'preset', entityId);
}

/**
 * Handle refresh button - fetch fresh data and update dashboard.
 * Preserves browseContext from existing session for back navigation.
 *
 * Uses a fallback strategy to handle stale session data:
 * 1. Try user endpoint first (works for owned + accessible global presets)
 * 2. If null and session indicated global, try global endpoint (admin only)
 *
 * This prevents refresh failures when isGlobal status changed in another session.
 */
export async function handleRefreshButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  await interaction.deferUpdate();

  // Get existing session to preserve browseContext
  const sessionManager = getSessionManager();
  const existingSession = await sessionManager.get<FlattenedPresetData>(
    interaction.user.id,
    'preset',
    entityId
  );
  const cachedIsGlobal = existingSession?.data.isGlobal ?? false;
  const existingBrowseContext = existingSession?.data.browseContext;

  // Try user endpoint first (works for owned presets AND accessible global presets)
  let preset = await fetchPreset(entityId, interaction.user.id);

  // Fallback: if null and session indicated global, try admin endpoint
  // This handles edge case where preset is still global but user endpoint failed
  if (preset === null && cachedIsGlobal) {
    preset = await fetchGlobalPreset(entityId);
  }

  if (preset === null) {
    await interaction.editReply({
      content: '❌ Preset not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  // Preserve browseContext from existing session
  const flattenedData: FlattenedPresetData = {
    ...flattenPresetData(preset),
    browseContext: existingBrowseContext,
  };

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
 */
export async function handleToggleGlobalButton(
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

  if (session === null) {
    await interaction.editReply({
      content: DASHBOARD_MESSAGES.SESSION_EXPIRED,
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
 * Handle delete button - show confirmation dialog.
 */
export async function handleDeleteButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  const sessionManager = getSessionManager();
  const session = await sessionManager.get<FlattenedPresetData>(
    interaction.user.id,
    'preset',
    entityId
  );

  if (session === null) {
    await interaction.reply({
      content: DASHBOARD_MESSAGES.SESSION_EXPIRED,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!session.data.isOwned) {
    await interaction.reply({
      content: '❌ You can only delete presets you own.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Build confirmation dialog using shared utility
  const { embed, components } = buildDeleteConfirmation({
    entityType: 'Preset',
    entityName: session.data.name,
    confirmCustomId: `preset::confirm-delete::${entityId}`,
    cancelCustomId: `preset::cancel-delete::${entityId}`,
  });

  await interaction.update({ embeds: [embed], components });
}

/**
 * Handle confirm-delete button - actually delete the preset.
 */
export async function handleConfirmDeleteButton(
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

  const presetName = session?.data.name ?? 'Preset';

  try {
    const result = await callGatewayApi<void>(`/user/llm-config/${entityId}`, {
      method: 'DELETE',
      userId: interaction.user.id,
    });

    if (!result.ok) {
      logger.warn(
        { userId: interaction.user.id, status: result.status, entityId },
        '[Preset] Failed to delete preset'
      );
      await interaction.editReply({
        content: `❌ Failed to delete preset: ${result.error}`,
        embeds: [],
        components: [],
      });
      return;
    }

    await sessionManager.delete(interaction.user.id, 'preset', entityId);

    await interaction.editReply({
      content: `✅ **${presetName}** has been deleted.`,
      embeds: [],
      components: [],
    });

    logger.info({ userId: interaction.user.id, entityId, presetName }, '[Preset] Deleted preset');
  } catch (error) {
    logger.error({ err: error, entityId }, 'Failed to delete preset');
    await interaction.editReply({
      content: '❌ An error occurred while deleting the preset. Please try again.',
      embeds: [],
      components: [],
    });
  }
}

/**
 * Handle cancel-delete button - return to dashboard.
 */
export async function handleCancelDeleteButton(
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

  if (session === null) {
    await interaction.editReply({
      content: DASHBOARD_MESSAGES.SESSION_EXPIRED,
      embeds: [],
      components: [],
    });
    return;
  }

  await refreshDashboardUI(interaction, entityId, session.data);
}

/**
 * Handle clone button - create a copy of the preset owned by the user.
 */
export async function handleCloneButton(
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

  if (session === null) {
    await interaction.editReply({
      content: DASHBOARD_MESSAGES.SESSION_EXPIRED,
      embeds: [],
      components: [],
    });
    return;
  }

  try {
    const config = getConfig();
    const sourceData = session.data;

    const clonedName = generateClonedName(sourceData.name);

    // Create the cloned preset with just name and model (required fields)
    const newPreset = await createPreset(
      {
        name: clonedName,
        model: sourceData.model,
        provider: sourceData.provider,
        description:
          sourceData.description !== undefined && sourceData.description.length > 0
            ? sourceData.description
            : undefined,
        maxReferencedMessages:
          sourceData.maxReferencedMessages !== undefined &&
          sourceData.maxReferencedMessages.length > 0
            ? parseInt(sourceData.maxReferencedMessages, 10)
            : undefined,
      },
      interaction.user.id,
      config
    );

    // Copy advanced parameters if the source had any
    const advancedParams = unflattenPresetData(sourceData);
    if (advancedParams.advancedParameters !== undefined) {
      await updatePreset(
        newPreset.id,
        { advancedParameters: advancedParams.advancedParameters },
        interaction.user.id
      );
    }

    // Fetch the complete cloned preset to get all fields
    const clonedPreset = await fetchPreset(newPreset.id, interaction.user.id);
    if (clonedPreset === null) {
      throw new Error('Failed to fetch cloned preset');
    }

    const flattenedData = flattenPresetData(clonedPreset);

    // Create a new session for the cloned preset
    await sessionManager.set({
      userId: interaction.user.id,
      entityType: 'preset',
      entityId: clonedPreset.id,
      data: flattenedData,
      messageId: interaction.message.id,
      channelId: interaction.channelId,
    });

    // Clean up old session
    await sessionManager.delete(interaction.user.id, 'preset', entityId);

    // Refresh dashboard to show the new cloned preset
    await refreshDashboardUI(interaction, clonedPreset.id, flattenedData);

    logger.info(
      { sourcePresetId: entityId, clonedPresetId: clonedPreset.id, userId: interaction.user.id },
      'Preset cloned successfully'
    );
  } catch (error) {
    logger.error({ err: error, entityId }, 'Failed to clone preset');
    await interaction.followUp({
      content: '❌ Failed to clone preset. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle back button - return to browse list using saved context.
 */
export async function handleBackButton(
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

  const browseContext = session?.data.browseContext;
  if (!browseContext) {
    // Session expired or no browse context - show expired message
    await interaction.editReply({
      content: formatSessionExpiredMessage('/preset browse'),
      embeds: [],
      components: [],
    });
    return;
  }

  try {
    const result = await buildBrowseResponse(interaction.user.id, {
      page: browseContext.page,
      filter: browseContext.filter as PresetBrowseFilter,
      query: browseContext.query ?? null,
    });

    if (result === null) {
      await interaction.editReply({
        content: '❌ Failed to load browse list. Please try again.',
        embeds: [],
        components: [],
      });
      return;
    }

    // Clear the session since we're leaving the dashboard
    await sessionManager.delete(interaction.user.id, 'preset', entityId);

    await interaction.editReply({ embeds: [result.embed], components: result.components });

    logger.info(
      { userId: interaction.user.id, entityId, page: browseContext.page },
      '[Preset] Returned to browse from dashboard'
    );
  } catch (error) {
    logger.error({ err: error, entityId }, '[Preset] Failed to return to browse');
    await interaction.editReply({
      content: '❌ Failed to load browse list. Please try again.',
      embeds: [],
      components: [],
    });
  }
}
