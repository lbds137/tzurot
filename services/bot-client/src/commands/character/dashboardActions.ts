/**
 * Character Dashboard Action Handlers
 *
 * Handles action menu selections from the character dashboard:
 * - Visibility toggle (public/private)
 * - Avatar upload redirect (modals can't accept files)
 * - Voice upload redirect (same constraint)
 * - Voice toggle (enable/disable TTS without clearing voice reference)
 *
 * Extracted from dashboard.ts to keep files under the max-lines limit.
 */

import { MessageFlags, type StringSelectMenuInteraction } from 'discord.js';
import { type EnvConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import {
  getCharacterDashboardConfig,
  buildCharacterDashboardOptions,
  type CharacterSessionData,
} from './config.js';
import type { CharacterData } from './characterTypes.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { fetchCharacter, updateCharacter, toggleVisibility } from './api.js';
import { ackUpdate } from '../../ux/render/reply.js';

const logger = createLogger('character-dashboard-actions');

/**
 * Refresh the dashboard after a character update.
 * Handles session preservation and dashboard rebuild.
 *
 * Exported for direct testing — only used internally by {@link handleAction}.
 */
export async function refreshDashboardAfterUpdate(
  interaction: StringSelectMenuInteraction,
  entityId: string,
  updated: CharacterData
): Promise<void> {
  const isAdmin = isBotOwner(interaction.user.id);
  const dashboardConfig = getCharacterDashboardConfig(isAdmin, updated.hasVoiceReference);

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<CharacterSessionData>(
    interaction.user.id,
    'character',
    entityId
  );

  const sessionData: CharacterSessionData = {
    ...updated,
    // updateCharacter now carries the server's canEdit; the session value
    // is only a fallback for callers passing a bare CharacterData.
    canEdit: updated.canEdit ?? session?.data?.canEdit,
    _isAdmin: isAdmin,
    browseContext: session?.data?.browseContext,
  };

  await sessionManager.update<CharacterSessionData>(
    interaction.user.id,
    'character',
    entityId,
    sessionData
  );

  const embed = buildDashboardEmbed(dashboardConfig, updated);
  const components = buildDashboardComponents(
    dashboardConfig,
    updated.slug,
    updated,
    buildCharacterDashboardOptions(sessionData)
  );

  await interaction.editReply({ embeds: [embed], components });
}

/**
 * Toggle definitionPublic (whether non-owners can see the character card).
 *
 * TOCTOU note: fetch-then-toggle, same acceptance as voice-toggle — a
 * single-user dashboard can just click again if a concurrent toggle won.
 */
async function handleDefinitionVisibilityToggle(
  interaction: StringSelectMenuInteraction,
  entityId: string,
  config: EnvConfig
): Promise<void> {
  await ackUpdate(interaction);

  const { userClient } = clientsFor(interaction);
  const character = await fetchCharacter(entityId, config, userClient);
  if (!character) {
    return;
  }

  const newDefinitionPublic = !character.definitionPublic;
  const { character: updated } = await updateCharacter(
    entityId,
    { definitionPublic: newDefinitionPublic },
    userClient,
    config
  );

  await refreshDashboardAfterUpdate(interaction, entityId, updated);

  const status = newDefinitionPublic ? '📖 Card Public' : '📕 Card Private';
  logger.info(
    { slug: entityId, definitionPublic: newDefinitionPublic },
    `Character definition visibility: ${status}`
  );
}

/**
 * Handle dashboard actions (visibility toggle, avatar upload, voice, etc.)
 */
export async function handleAction(
  interaction: StringSelectMenuInteraction,
  entityId: string,
  actionId: string,
  config: EnvConfig
): Promise<void> {
  if (actionId === 'visibility') {
    // Uses a dedicated API endpoint (PATCH /personalities/:slug/visibility) rather than
    // the general update endpoint, since visibility changes may have additional side effects.
    await ackUpdate(interaction);

    const { userClient } = clientsFor(interaction);
    const character = await fetchCharacter(entityId, config, userClient);
    if (!character) {
      return;
    }

    const result = await toggleVisibility(entityId, !character.isPublic, userClient, config);

    const updated: CharacterData = { ...character, isPublic: result.isPublic };
    await refreshDashboardAfterUpdate(interaction, entityId, updated);

    const status = result.isPublic ? '🌐 Public' : '🔒 Private';
    logger.info({ slug: entityId, isPublic: result.isPublic }, `Character visibility: ${status}`);
    return;
  }

  if (actionId === 'avatar') {
    // Redirect to slash command — Discord modals can only contain text inputs,
    // not file upload fields, so avatar upload requires a separate command.
    // eslint-disable-next-line @tzurot/component-handler-ack-first -- Branch-leak FP: static redirect, no async in this branch. The rule's source-order sawRealAsync leaked from the earlier `visibility` branch's fetchCharacter/toggleVisibility (which is ack-first via its own deferUpdate); this reply IS ack-first for the avatar branch.
    await interaction.reply({
      content:
        '🖼️ **Avatar Upload**\n\n' +
        'Please use `/character avatar set` to upload a new avatar image.\n' +
        '(Discord modals cannot accept file uploads)',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (actionId === 'voice') {
    // eslint-disable-next-line @tzurot/component-handler-ack-first -- Branch-leak FP: static redirect, no async in this branch; sawRealAsync leaked from the earlier `visibility` branch. This reply IS ack-first for the voice branch.
    await interaction.reply({
      content:
        '🎤 **Voice Reference**\n\n' +
        'Use `/character voice set` to upload a voice reference for TTS cloning.\n' +
        'Use `/character voice clear` to remove it and disable TTS.\n' +
        '(Discord modals cannot accept file uploads)',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (actionId === 'definition-visibility') {
    await handleDefinitionVisibilityToggle(interaction, entityId, config);
    return;
  }

  if (actionId === 'voice-toggle') {
    // TOCTOU note: We fetch-then-toggle, so a concurrent toggle could invert
    // the wrong value. Acceptable for a single-user dashboard — the user can
    // just click again if the state looks wrong.
    // eslint-disable-next-line @tzurot/component-handler-ack-first -- Branch-leak FP: this ackUpdate IS ack-first for the voice-toggle branch (fetchCharacter/updateCharacter follow it); sawRealAsync leaked from the sibling `visibility` branch's async above.
    await ackUpdate(interaction);

    const { userClient } = clientsFor(interaction);
    const character = await fetchCharacter(entityId, config, userClient);
    if (!character) {
      return;
    }

    // Guard: the toggle button is only shown when hasVoiceReference is true,
    // but a stale session could allow this action after `voice clear` was run.
    if (!character.hasVoiceReference) {
      logger.warn({ slug: entityId }, 'voice-toggle called but no voice reference exists');
      await refreshDashboardAfterUpdate(interaction, entityId, character);
      return;
    }

    const newVoiceEnabled = !character.voiceEnabled;
    const { character: updated } = await updateCharacter(
      entityId,
      { voiceEnabled: newVoiceEnabled },
      userClient,
      config
    );

    await refreshDashboardAfterUpdate(interaction, entityId, updated);

    const status = newVoiceEnabled ? '🔊 Enabled' : '🔇 Disabled';
    logger.info({ slug: entityId, voiceEnabled: newVoiceEnabled }, `Character voice: ${status}`);
    return;
  }

  logger.warn({ actionId }, 'Unknown action');
}
