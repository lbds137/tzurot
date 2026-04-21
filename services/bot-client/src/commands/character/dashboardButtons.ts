/**
 * Character Dashboard Button Handlers
 *
 * Extracted from dashboard.ts to keep file under 500 lines.
 * Handles back, refresh, close, and delete button actions.
 */

import type { ButtonInteraction } from 'discord.js';
import { getConfig, isBotOwner } from '@tzurot/common-types';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
  handleDashboardClose,
  DASHBOARD_MESSAGES,
  renderTerminalScreen,
} from '../../utils/dashboard/index.js';
import {
  getCharacterDashboardConfig,
  buildCharacterDashboardOptions,
  type CharacterSessionData,
} from './config.js';
import type { CharacterData } from './characterTypes.js';
import { toGatewayUser } from '../../utils/userGatewayClient.js';
import { fetchCharacter } from './api.js';

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
