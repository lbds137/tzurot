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
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi, toGatewayUser } from '../../utils/userGatewayClient.js';
import {
  buildDeleteConfirmation,
  handleDashboardClose,
  getSessionManager,
  requireDeferredSession,
  getSessionDataOrReply,
  checkOwnership,
  DASHBOARD_MESSAGES,
  formatSessionExpiredMessage,
  renderTerminalScreen,
} from '../../utils/dashboard/index.js';
import { refreshDashboardUI } from '../../utils/dashboard/refreshHandler.js';
import {
  PRESET_DASHBOARD_CONFIG,
  type FlattenedPresetData,
  flattenPresetData,
  unflattenPresetData,
  buildPresetDashboardOptions,
} from './config.js';
import { fetchPreset, updatePreset, fetchGlobalPreset, extractApiErrorMessage } from './api.js';
import { createClonedPreset } from './cloneName.js';
import { buildBrowseResponse, type PresetBrowseFilter } from './browse.js';

// Re-export for backward compatibility
export { buildPresetDashboardOptions } from './config.js';

const logger = createLogger('preset-dashboard-buttons');

/** Recovery command shown in expired session messages */
const PRESET_RECOVERY_CMD = '/preset browse';

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
  let preset = await fetchPreset(entityId, toGatewayUser(interaction.user));

  // Fallback: if null and session indicated global, try admin endpoint
  // This handles edge case where preset is still global but user endpoint failed
  if (preset === null && cachedIsGlobal) {
    preset = await fetchGlobalPreset(entityId);
  }

  if (preset === null) {
    // Preset gone (deleted elsewhere). If the user came from /preset browse,
    // the helper will render a Back-to-Browse button so they're not stranded.
    await renderTerminalScreen({
      interaction,
      session: {
        userId: interaction.user.id,
        entityType: 'preset',
        entityId,
        browseContext: existingBrowseContext,
      },
      content: DASHBOARD_MESSAGES.NOT_FOUND('Preset'),
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

  await refreshDashboardUI({
    interaction,
    entityId,
    data: flattenedData,
    dashboardConfig: PRESET_DASHBOARD_CONFIG,
    buildOptions: buildPresetDashboardOptions,
  });
}

/**
 * Handle toggle-global button - toggle preset visibility.
 *
 * Fetches fresh data from API before toggling to prevent race conditions
 * when isGlobal status changed in another session.
 */
export async function handleToggleGlobalButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  const session = await requireDeferredSession<FlattenedPresetData>(
    interaction,
    'preset',
    entityId,
    PRESET_RECOVERY_CMD
  );
  if (session === null) {
    return;
  }

  // Check ownership (deferred, so use followUp for errors)
  if (
    !(await checkOwnership(interaction, session.data, 'toggle global status for presets', {
      deferred: true,
    }))
  ) {
    return;
  }

  try {
    // Fetch fresh data to prevent race condition with stale session.data.isGlobal
    const freshPreset = await fetchPreset(entityId, toGatewayUser(interaction.user));
    if (freshPreset === null) {
      await interaction.followUp({
        content: DASHBOARD_MESSAGES.NOT_FOUND('Preset'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const newIsGlobal = !freshPreset.isGlobal;
    const updatedPreset = await updatePreset(
      entityId,
      { isGlobal: newIsGlobal },
      toGatewayUser(interaction.user)
    );

    const flattenedData = flattenPresetData(updatedPreset);
    const sessionManager = getSessionManager();

    await sessionManager.update<FlattenedPresetData>(
      interaction.user.id,
      'preset',
      entityId,
      flattenedData
    );

    await refreshDashboardUI({
      interaction,
      entityId,
      data: flattenedData,
      dashboardConfig: PRESET_DASHBOARD_CONFIG,
      buildOptions: buildPresetDashboardOptions,
    });

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
  // Get session data or reply with expired message (non-deferred)
  const data = await getSessionDataOrReply<FlattenedPresetData>(interaction, 'preset', entityId);
  if (data === null) {
    return;
  }

  // Permission gate: use server-computed canDelete so bot-owner/admin can
  // delete any preset (including globals and other users'). checkOwnership
  // was UI-only and wouldn't honor the admin override from
  // computeLlmConfigPermissions.
  if (data.canDelete !== true) {
    await interaction.reply({
      content: DASHBOARD_MESSAGES.NO_PERMISSION('delete presets'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Build confirmation dialog using shared utility
  const { embed, components } = buildDeleteConfirmation({
    entityType: 'Preset',
    entityName: data.name,
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
      user: toGatewayUser(interaction.user),
    });

    // Build the terminal session descriptor once — the helper uses its
    // `browseContext` field to decide whether to render a Back-to-Browse
    // button (and keep the session alive) or close out cleanly.
    const terminalSession = {
      userId: interaction.user.id,
      entityType: 'preset',
      entityId,
      browseContext: session?.data.browseContext,
    };

    if (!result.ok) {
      logger.warn(
        { userId: interaction.user.id, status: result.status, entityId },
        '[Preset] Failed to delete preset'
      );
      await renderTerminalScreen({
        interaction,
        session: terminalSession,
        content: `❌ Failed to delete preset: ${result.error}`,
      });
      return;
    }

    await renderTerminalScreen({
      interaction,
      session: terminalSession,
      content: `✅ **${presetName}** has been deleted.`,
    });

    logger.info({ userId: interaction.user.id, entityId, presetName }, '[Preset] Deleted preset');
  } catch (error) {
    logger.error({ err: error, entityId }, 'Failed to delete preset');
    await renderTerminalScreen({
      interaction,
      session: {
        userId: interaction.user.id,
        entityType: 'preset',
        entityId,
        browseContext: session?.data.browseContext,
      },
      content: '❌ An error occurred while deleting the preset. Please try again.',
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
  const session = await requireDeferredSession<FlattenedPresetData>(
    interaction,
    'preset',
    entityId,
    PRESET_RECOVERY_CMD
  );
  if (session === null) {
    return;
  }

  await refreshDashboardUI({
    interaction,
    entityId,
    data: session.data,
    dashboardConfig: PRESET_DASHBOARD_CONFIG,
    buildOptions: buildPresetDashboardOptions,
  });
}

/**
 * Handle clone button - create a copy of the preset owned by the user.
 */
export async function handleCloneButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  const session = await requireDeferredSession<FlattenedPresetData>(
    interaction,
    'preset',
    entityId,
    PRESET_RECOVERY_CMD
  );
  if (session === null) {
    return;
  }

  try {
    const sourceData = session.data;
    const sessionManager = getSessionManager();

    // Auto-number past any existing collisions. generateClonedName picks a
    // candidate based on the source name alone — it can't know what already
    // exists in the user's library, so cloning the original twice produces
    // the same "(Copy)" candidate both times. Retry with a bumped suffix on
    // the gateway's name-collision validation error; surface anything else.
    const newPreset = await createClonedPreset(sourceData, toGatewayUser(interaction.user));

    // Build update payload with all non-basic fields from source
    const updatePayload = unflattenPresetData(sourceData);

    // Remove fields already set during creation
    delete updatePayload.name;
    delete updatePayload.model;
    delete updatePayload.provider;
    delete updatePayload.description;
    delete updatePayload.visionModel;

    // Copy visibility setting (isGlobal)
    if (sourceData.isGlobal === true) {
      updatePayload.isGlobal = true;
    }

    // Apply updates if needed
    if (Object.keys(updatePayload).length > 0) {
      await updatePreset(newPreset.id, updatePayload, toGatewayUser(interaction.user));
    }

    // Fetch the complete cloned preset to get all fields
    const clonedPreset = await fetchPreset(newPreset.id, toGatewayUser(interaction.user));
    if (clonedPreset === null) {
      throw new Error('Failed to fetch cloned preset');
    }

    const flattenedData = flattenPresetData(clonedPreset);

    // Carry the browse context forward so the cloned preset's dashboard still
    // offers a Back-to-Browse affordance — the user came from /preset browse,
    // and jumping into the clone shouldn't strand them.
    if (sourceData.browseContext !== undefined) {
      flattenedData.browseContext = sourceData.browseContext;
    }

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
    await refreshDashboardUI({
      interaction,
      entityId: clonedPreset.id,
      data: flattenedData,
      dashboardConfig: PRESET_DASHBOARD_CONFIG,
      buildOptions: buildPresetDashboardOptions,
    });

    logger.info(
      { sourcePresetId: entityId, clonedPresetId: clonedPreset.id, userId: interaction.user.id },
      'Preset cloned successfully'
    );
  } catch (error) {
    logger.error({ err: error, entityId }, 'Failed to clone preset');

    await interaction.followUp({
      content: `❌ ${extractApiErrorMessage(error) ?? 'Failed to clone preset. Please try again.'}`,
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
  const session = await requireDeferredSession<FlattenedPresetData>(
    interaction,
    'preset',
    entityId,
    PRESET_RECOVERY_CMD
  );
  if (session === null) {
    return;
  }

  const browseContext = session.data.browseContext;
  if (!browseContext) {
    // Session exists but no browse context — back-button shouldn't have been
    // rendered in the first place. Render a terminal notice and clean up.
    // (browseContext: undefined → helper skips the button, deletes session.)
    await renderTerminalScreen({
      interaction,
      session: {
        userId: interaction.user.id,
        entityType: 'preset',
        entityId,
        browseContext: undefined,
      },
      content: formatSessionExpiredMessage(PRESET_RECOVERY_CMD),
    });
    return;
  }

  try {
    const result = await buildBrowseResponse(toGatewayUser(interaction.user), {
      page: browseContext.page,
      filter: browseContext.filter as PresetBrowseFilter,
      query: browseContext.query ?? null,
    });

    if (result === null) {
      // Can't rebuild browse — re-adding a back button would just re-enter
      // this failing path. Render as terminal with no affordance and clean
      // up the now-dead session.
      await renderTerminalScreen({
        interaction,
        session: {
          userId: interaction.user.id,
          entityType: 'preset',
          entityId,
          browseContext: undefined,
        },
        content: '❌ Failed to load browse list. Please try again.',
      });
      return;
    }

    // Clear the session since we're leaving the dashboard
    const sessionManager = getSessionManager();
    await sessionManager.delete(interaction.user.id, 'preset', entityId);

    await interaction.editReply({ embeds: [result.embed], components: result.components });

    logger.info(
      { userId: interaction.user.id, entityId, page: browseContext.page },
      '[Preset] Returned to browse from dashboard'
    );
  } catch (error) {
    logger.error({ err: error, entityId }, '[Preset] Failed to return to browse');
    // Same rationale as the null-result path above.
    await renderTerminalScreen({
      interaction,
      session: {
        userId: interaction.user.id,
        entityType: 'preset',
        entityId,
        browseContext: undefined,
      },
      content: '❌ Failed to load browse list. Please try again.',
    });
  }
}
