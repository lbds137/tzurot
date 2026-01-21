/**
 * Preset Global Edit Handler
 * Handles /preset global edit subcommand
 * Opens the preset dashboard for editing global presets (owner only)
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../../utils/dashboard/index.js';
import { PRESET_DASHBOARD_CONFIG, flattenPresetData } from '../config.js';
import { fetchGlobalPreset } from '../api.js';

const logger = createLogger('preset-global-edit');

/**
 * Handle /preset global edit
 * Opens the preset dashboard for a global preset
 * Note: Owner check is done at the command routing level in index.ts
 */
export async function handleGlobalEdit(context: DeferredCommandContext): Promise<void> {
  const configId = context.interaction.options.getString('config', true);
  const userId = context.user.id;

  try {
    // Fetch the global preset
    const preset = await fetchGlobalPreset(configId);

    if (!preset) {
      await context.editReply({ content: '❌ Global preset not found.' });
      return;
    }

    // Flatten the data for dashboard display
    const flattenedData = flattenPresetData(preset);

    // Build dashboard embed and components
    const embed = buildDashboardEmbed(PRESET_DASHBOARD_CONFIG, flattenedData);
    const components = buildDashboardComponents(PRESET_DASHBOARD_CONFIG, configId, flattenedData, {
      showClose: true,
      showRefresh: true,
    });

    // Send dashboard
    const reply = await context.editReply({ embeds: [embed], components });

    // Create session for tracking
    const sessionManager = getSessionManager();
    await sessionManager.set({
      userId,
      entityType: 'preset',
      entityId: configId,
      data: flattenedData,
      messageId: reply.id,
      channelId: context.channelId,
    });

    logger.info(
      { userId, configId, name: preset.name },
      '[Preset/Global] Opened global preset edit dashboard'
    );
  } catch (error) {
    logger.error({ err: error, configId }, '[Preset/Global] Failed to open preset edit dashboard');
    await context.editReply({ content: '❌ Failed to load global preset. Please try again.' });
  }
}
