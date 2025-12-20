/**
 * Character Edit Handler
 *
 * Opens the dashboard for editing an existing character.
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, type EnvConfig } from '@tzurot/common-types';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import { characterDashboardConfig } from './config.js';
import { fetchCharacter } from './api.js';

const logger = createLogger('character-edit');

/**
 * Handle the edit subcommand - show dashboard for selected character
 */
export async function handleEdit(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler
  const slug = interaction.options.getString('character', true);

  try {
    // Fetch character data from API
    const character = await fetchCharacter(slug, config, interaction.user.id);
    if (!character) {
      await interaction.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }

    // Use server-side permission check (compares internal User UUIDs, not Discord IDs)
    if (!character.canEdit) {
      await interaction.editReply(
        `❌ You don't have permission to edit \`${slug}\`.\n` +
          'You can only edit characters you own.'
      );
      return;
    }

    // Build and send dashboard
    // Use slug as entityId (not UUID) because fetchCharacter expects slug
    const embed = buildDashboardEmbed(characterDashboardConfig, character);
    const components = buildDashboardComponents(
      characterDashboardConfig,
      character.slug,
      character,
      {
        showClose: true,
        showRefresh: true,
      }
    );

    const reply = await interaction.editReply({ embeds: [embed], components });

    // Create session for tracking (keyed by slug)
    const sessionManager = getSessionManager();
    sessionManager.set({
      userId: interaction.user.id,
      entityType: 'character',
      entityId: character.slug,
      data: character,
      messageId: reply.id,
      channelId: interaction.channelId,
    });

    logger.info(
      { userId: interaction.user.id, slug: character.slug },
      'Character dashboard opened'
    );
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to open character dashboard');
    await interaction.editReply('❌ Failed to load character. Please try again.');
  }
}
