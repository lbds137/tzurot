/**
 * Preset Global Edit Handler
 * Handles /preset global edit subcommand
 * Opens the preset dashboard for editing global presets (owner only)
 */

import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
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
export async function handleGlobalEdit(interaction: ChatInputCommandInteraction): Promise<void> {
  const configId = interaction.options.getString('config', true);
  const userId = interaction.user.id;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Fetch the global preset
    const preset = await fetchGlobalPreset(configId);

    if (!preset) {
      await interaction.editReply('❌ Global preset not found.');
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
    const reply = await interaction.editReply({ embeds: [embed], components });

    // Create session for tracking
    const sessionManager = getSessionManager();
    await sessionManager.set({
      userId,
      entityType: 'preset',
      entityId: configId,
      data: flattenedData,
      messageId: reply.id,
      channelId: interaction.channelId ?? '',
    });

    logger.info(
      { userId, configId, name: preset.name },
      '[Preset/Global] Opened global preset edit dashboard'
    );
  } catch (error) {
    logger.error({ err: error, configId }, '[Preset/Global] Failed to open preset edit dashboard');
    await interaction.editReply('❌ Failed to load global preset. Please try again.');
  }
}
