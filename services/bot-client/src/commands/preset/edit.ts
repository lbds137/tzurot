/**
 * Preset Command - Edit Handler
 *
 * Opens the preset dashboard for editing presets.
 * - Users can edit their own presets
 * - Bot owner can edit any preset (including global)
 * - Non-owners can view global presets in autocomplete but cannot edit them
 */

import { createLogger, presetEditOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import { PRESET_DASHBOARD_CONFIG, flattenPresetData } from './config.js';
import { fetchPreset } from './api.js';
import { buildPresetDashboardOptions } from './dashboardButtons.js';

const logger = createLogger('preset-edit');

/**
 * Handle /preset edit command
 * Opens the preset dashboard for the selected preset
 */
export async function handleEdit(context: DeferredCommandContext): Promise<void> {
  const options = presetEditOptions(context.interaction);
  const presetId = options.preset();
  const userId = context.user.id;

  try {
    // Fetch the preset
    const preset = await fetchPreset(presetId, userId);

    if (!preset) {
      await context.editReply({ content: '❌ Preset not found.' });
      return;
    }

    // Use server-computed permissions for authorization
    // This is computed on the API side and includes admin checks
    if (!preset.permissions.canEdit) {
      // User doesn't own the preset and isn't the bot owner
      if (preset.isGlobal) {
        await context.editReply({
          content:
            '❌ Global presets can only be edited by the bot owner.\n' +
            'Use `/preset create` to create your own copy based on this preset.',
        });
      } else {
        await context.editReply({
          content:
            '❌ You can only edit your own presets.\n' +
            'Use `/preset create` to create a copy of this preset.',
        });
      }
      return;
    }

    // Flatten the data for dashboard display
    const flattenedData = flattenPresetData(preset);

    // Build dashboard embed and components
    // Use buildPresetDashboardOptions for consistent button configuration (includes delete for owned presets)
    const embed = buildDashboardEmbed(PRESET_DASHBOARD_CONFIG, flattenedData);
    const components = buildDashboardComponents(
      PRESET_DASHBOARD_CONFIG,
      presetId,
      flattenedData,
      buildPresetDashboardOptions(flattenedData)
    );

    // Send dashboard
    const reply = await context.editReply({ embeds: [embed], components });

    // Create session for tracking
    const sessionManager = getSessionManager();
    await sessionManager.set({
      userId,
      entityType: 'preset',
      entityId: presetId,
      data: flattenedData,
      messageId: reply.id,
      channelId: context.channelId,
    });

    logger.info({ userId, presetId, name: preset.name }, 'Opened preset edit dashboard');
  } catch (error) {
    logger.error({ err: error, presetId }, 'Failed to open preset edit dashboard');
    await context.editReply({ content: '❌ Failed to load preset. Please try again.' });
  }
}
