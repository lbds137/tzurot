/**
 * Character Dashboard Button Handlers
 *
 * Extracted from dashboard.ts to keep file under 500 lines.
 * Handles back, refresh, close, and delete button actions.
 */

import type { ButtonInteraction } from 'discord.js';
import { createLogger, getConfig, isBotOwner } from '@tzurot/common-types';
import { handleDashboardClose } from '../../utils/dashboard/closeHandler.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import { DASHBOARD_MESSAGES, formatSessionExpiredMessage } from '../../utils/dashboard/messages.js';
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
  const components = buildDashboardComponents(dashboardConfig, character.slug, character, {
    showBack: existingBrowseContext !== undefined, // Show back if came from browse
    showClose: existingBrowseContext === undefined, // Show close if opened directly
    showRefresh: true,
    showDelete: character.canEdit,
  });

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
