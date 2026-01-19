/**
 * Preset Command - Edit Handler
 *
 * Opens the preset dashboard for editing presets.
 * - Users can edit their own presets
 * - Bot owner can edit any preset (including global)
 * - Non-owners can view global presets in autocomplete but cannot edit them
 */

import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, isBotOwner } from '@tzurot/common-types';
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

    // Check if user can edit this preset:
    // - User owns the preset, OR
    // - User is bot owner (can edit any preset including global)
    const canEdit = preset.isOwned || isBotOwner(userId);

    if (!canEdit) {
      // User doesn't own the preset and isn't the bot owner
      if (preset.isGlobal) {
        await interaction.editReply(
          '❌ Global presets can only be edited by the bot owner.\n' +
            'Use `/preset create` to create your own copy based on this preset.'
        );
      } else {
        await interaction.editReply(
          '❌ You can only edit your own presets.\n' +
            'Use `/preset create` to create a copy of this preset.'
        );
      }
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
