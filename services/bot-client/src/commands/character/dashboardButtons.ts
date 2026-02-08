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
  getSessionOrExpired,
  handleDashboardClose,
  DASHBOARD_MESSAGES,
  formatSessionExpiredMessage,
} from '../../utils/dashboard/index.js';
import {
  getCharacterDashboardConfig,
  buildCharacterDashboardOptions,
  type CharacterData,
  type CharacterSessionData,
  type CharacterBrowseFilter,
  type CharacterBrowseSortType,
} from './config.js';
import { fetchCharacter } from './api.js';
import { buildBrowseResponse } from './browse.js';

// Re-export for backward compatibility
export { buildCharacterDashboardOptions } from './config.js';

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

  // Get session or show expired message
  const session = await getSessionOrExpired<CharacterData>(
    interaction,
    'character',
    entityId,
    '/character browse'
  );
  if (session === null) {
    return;
  }

  const browseContext = session.data.browseContext;
  if (!browseContext) {
    // Session exists but no browse context - shouldn't happen, show expired
    await interaction.editReply({
      content: formatSessionExpiredMessage('/character browse'),
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

    // Clear the session since we're leaving the dashboard
    const sessionManager = getSessionManager();
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
 * Handle refresh button - reload character data while preserving browseContext
 */
export async function handleRefreshButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  const config = getConfig();
  await interaction.deferUpdate();

  // Get existing session to preserve browseContext
  const sessionManager = getSessionManager();
  const existingSession = await sessionManager.get<CharacterData>(
    interaction.user.id,
    'character',
    entityId
  );
  const existingBrowseContext = existingSession?.data.browseContext;

  const character = await fetchCharacter(entityId, config, interaction.user.id);
  if (!character) {
    await interaction.editReply({
      content: DASHBOARD_MESSAGES.NOT_FOUND('Character'),
      embeds: [],
      components: [],
    });
    return;
  }

  const isAdmin = isBotOwner(interaction.user.id);
  const dashboardConfig = getCharacterDashboardConfig(isAdmin);

  // Preserve browseContext from existing session
  const sessionData: CharacterSessionData = {
    ...character,
    _isAdmin: isAdmin,
    browseContext: existingBrowseContext,
  };

  await sessionManager.set({
    userId: interaction.user.id,
    entityType: 'character',
    entityId,
    data: sessionData,
    messageId: interaction.message.id,
    channelId: interaction.channelId,
  });

  const embed = buildDashboardEmbed(dashboardConfig, character);
  const components = buildDashboardComponents(
    dashboardConfig,
    character.slug,
    character,
    buildCharacterDashboardOptions(sessionData)
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
  await handleDashboardClose(interaction, 'character', entityId);
}
