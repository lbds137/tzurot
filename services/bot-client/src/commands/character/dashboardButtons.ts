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
  renderTerminalScreen,
} from '../../utils/dashboard/index.js';
import {
  getCharacterDashboardConfig,
  buildCharacterDashboardOptions,
  type CharacterData,
  type CharacterSessionData,
  type CharacterBrowseFilter,
  type CharacterBrowseSortType,
} from './config.js';
import { toGatewayUser } from '../../utils/userGatewayClient.js';
import { fetchCharacter } from './api.js';
import { buildBrowseResponse } from './browse.js';

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

  // All three error branches below render as terminal-with-no-back-button
  // (re-adding the back-button would re-enter the failing path) and clean up
  // the now-dead session. Share the session descriptor.
  const noContextSession = {
    userId: interaction.user.id,
    entityType: 'character' as const,
    entityId,
    browseContext: undefined,
  };

  const browseContext = session.data.browseContext;
  if (!browseContext) {
    // Session exists but no browse context - shouldn't happen; terminate cleanly.
    await renderTerminalScreen({
      interaction,
      session: noContextSession,
      content: formatSessionExpiredMessage('/character browse'),
    });
    return;
  }

  try {
    const { embed, components } = await buildBrowseResponse(
      toGatewayUser(interaction.user),
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
    await renderTerminalScreen({
      interaction,
      session: noContextSession,
      content: '❌ Failed to load browse list. Please try again.',
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

  const character = await fetchCharacter(entityId, config, toGatewayUser(interaction.user));
  if (!character) {
    // Character gone (deleted elsewhere). If the user came from /character
    // browse, renderTerminalScreen preserves Back-to-Browse so they're not
    // stranded.
    await renderTerminalScreen({
      interaction,
      session: {
        userId: interaction.user.id,
        entityType: 'character' as const,
        entityId,
        browseContext: existingBrowseContext,
      },
      content: DASHBOARD_MESSAGES.NOT_FOUND('Character'),
    });
    return;
  }

  const isAdmin = isBotOwner(interaction.user.id);
  const dashboardConfig = getCharacterDashboardConfig(isAdmin, character.hasVoiceReference);

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
