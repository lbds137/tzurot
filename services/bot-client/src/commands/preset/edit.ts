/**
 * Preset Command - Edit Handler
 *
 * Opens the preset dashboard for editing user-owned presets.
 * Users can modify LLM parameters through section-based modals.
 */

import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import { PRESET_DASHBOARD_CONFIG, flattenPresetData } from './config.js';
import { fetchPreset } from './api.js';

const logger = createLogger('preset-edit');

/**
 * Handle /preset edit command
 * Opens the preset dashboard for the selected preset
 */
export async function handleEdit(interaction: ChatInputCommandInteraction): Promise<void> {
  const presetId = interaction.options.getString('preset', true);
  const userId = interaction.user.id;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Fetch the preset
    const preset = await fetchPreset(presetId, userId);

    if (!preset) {
      await interaction.editReply('❌ Preset not found.');
      return;
    }

    // Check if user can edit this preset
    if (!preset.isOwned) {
      await interaction.editReply(
        '❌ You can only edit your own presets.\n' +
          'Use `/preset create` to create a copy of this preset.'
      );
      return;
    }

    // Flatten the data for dashboard display
    const flattenedData = flattenPresetData(preset);

    // Build dashboard embed and components
    const embed = buildDashboardEmbed(PRESET_DASHBOARD_CONFIG, flattenedData);
    const components = buildDashboardComponents(PRESET_DASHBOARD_CONFIG, presetId, flattenedData, {
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
      entityId: presetId,
      data: flattenedData,
      messageId: reply.id,
      channelId: interaction.channelId ?? '',
    });

    logger.info({ userId, presetId, name: preset.name }, 'Opened preset edit dashboard');
  } catch (error) {
    logger.error({ err: error, presetId }, 'Failed to open preset edit dashboard');
    await interaction.editReply('❌ Failed to load preset. Please try again.');
  }
}
