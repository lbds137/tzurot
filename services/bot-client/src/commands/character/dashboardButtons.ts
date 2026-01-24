/**
 * Character Dashboard Button Handlers
 *
 * Extracted from dashboard.ts to keep file under 500 lines.
 * Handles back, refresh, close, and delete button actions.
 */

import type { ButtonInteraction } from 'discord.js';
import { createLogger, getConfig, isBotOwner } from '@tzurot/common-types';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import { getCharacterDashboardConfig, type CharacterData } from './config.js';
import type { CharacterSessionData } from './edit.js';
import { fetchCharacter } from './api.js';
import {
  buildBrowseResponse,
  type CharacterBrowseFilter,
  type CharacterBrowseSortType,
} from './browse.js';

const logger = createLogger('character-dashboard-buttons');

/**
 * Handle back button - return to browse list
 */
export async function handleBackButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  const config = getConfig();
  await interaction.deferUpdate();

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<CharacterData>(
    interaction.user.id,
    'character',
    entityId
  );

  const browseContext = session?.data.browseContext;
  if (!browseContext) {
    await interaction.editReply({
      content: '⏰ Session expired. Please run `/character browse` again.',
      embeds: [],
      components: [],
    });
    return;
  }

  try {
    const { embed, components } = await buildBrowseResponse(
      interaction.user.id,
      interaction.client,
      config,
      {
        page: browseContext.page,
        filter: browseContext.filter as CharacterBrowseFilter,
        sort: (browseContext.sort ?? 'date') as CharacterBrowseSortType,
        query: browseContext.query ?? null,
      }
    );

    await sessionManager.delete(interaction.user.id, 'character', entityId);
    await interaction.editReply({ embeds: [embed], components });

    logger.info(
      { userId: interaction.user.id, entityId, page: browseContext.page },
      '[Character] Returned to browse from dashboard'
    );
  } catch (error) {
    logger.error({ err: error, entityId }, '[Character] Failed to return to browse');
    await interaction.editReply({
      content: '❌ Failed to load browse list. Please try again.',
      embeds: [],
      components: [],
    });
  }
}

/**
 * Handle refresh button - reload character data
 */
export async function handleRefreshButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  const config = getConfig();
  await interaction.deferUpdate();

  const character = await fetchCharacter(entityId, config, interaction.user.id);
  if (!character) {
    await interaction.editReply({ content: '❌ Character not found.', embeds: [], components: [] });
    return;
  }

  const isAdmin = isBotOwner(interaction.user.id);
  const dashboardConfig = getCharacterDashboardConfig(isAdmin);
  const sessionManager = getSessionManager();
  const sessionData: CharacterSessionData = { ...character, _isAdmin: isAdmin };

  await sessionManager.set({
    userId: interaction.user.id,
    entityType: 'character',
    entityId,
    data: sessionData,
    messageId: interaction.message.id,
    channelId: interaction.channelId,
  });

  const embed = buildDashboardEmbed(dashboardConfig, character);
  const components = buildDashboardComponents(dashboardConfig, character.slug, character, {
    showClose: true,
    showRefresh: true,
    showDelete: character.canEdit,
  });

  await interaction.editReply({ embeds: [embed], components });
}

/**
 * Handle close button - delete session and close dashboard
 */
export async function handleCloseButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  const sessionManager = getSessionManager();
  await sessionManager.delete(interaction.user.id, 'character', entityId);
  await interaction.update({ content: '✅ Dashboard closed.', embeds: [], components: [] });
}
