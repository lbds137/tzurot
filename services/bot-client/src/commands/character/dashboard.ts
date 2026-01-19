/**
 * Character Command - Dashboard Interaction Handlers
 *
 * Handles all dashboard interactions:
 * - Select menu for editing sections or triggering actions
 * - Button clicks (close, refresh, pagination)
 * - Modal submissions for section edits
 */

import { MessageFlags } from 'discord.js';
import type {
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger, getConfig, type EnvConfig } from '@tzurot/common-types';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildDashboardCustomId,
  buildSectionModal,
  extractModalValues,
  getSessionManager,
  parseDashboardCustomId,
  isDashboardInteraction,
} from '../../utils/dashboard/index.js';
import { CharacterCustomIds } from '../../utils/customIds.js';
import { characterDashboardConfig, type CharacterData } from './config.js';
import { fetchCharacter, updateCharacter, toggleVisibility } from './api.js';
import { handleSeedModalSubmit } from './create.js';
import { handleListPagination } from './list.js';
import { handleViewPagination, handleExpandField } from './view.js';

const logger = createLogger('character-dashboard');

/**
 * Handle modal submissions for character creation and editing
 */
export async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  config: EnvConfig
): Promise<void> {
  const customId = interaction.customId;

  // Handle seed modal (new character)
  // Format: character::seed
  if (customId === buildDashboardCustomId('character', 'seed')) {
    await handleSeedModalSubmit(interaction, config);
    return;
  }

  // Handle section edit modals
  // Format: character::modal::{entityId}::{sectionId}
  const parsed = parseDashboardCustomId(customId);
  if (
    parsed?.entityType === 'character' &&
    parsed.action === 'modal' &&
    parsed.entityId !== undefined &&
    parsed.sectionId !== undefined
  ) {
    await handleSectionModalSubmit(interaction, parsed.entityId, parsed.sectionId, config);
    return;
  }

  logger.warn({ customId }, 'Unknown modal submission');
  await interaction.reply({
    content: '❌ Unknown form submission.',
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Handle section modal submission - update character field
 */
async function handleSectionModalSubmit(
  interaction: ModalSubmitInteraction,
  entityId: string,
  sectionId: string,
  config: EnvConfig
): Promise<void> {
  await interaction.deferUpdate();

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<CharacterData>(
    interaction.user.id,
    'character',
    entityId
  );

  if (session === null) {
    // Session expired - try to refresh data and continue
    logger.warn({ entityId, sectionId }, 'Session not found for modal submit');
  }

  // Find the section config
  const section = characterDashboardConfig.sections.find(s => s.id === sectionId);
  if (!section) {
    logger.error({ sectionId }, 'Unknown section');
    return;
  }

  // Extract values from modal
  const values = extractModalValues(
    interaction,
    section.fields.map(f => f.id)
  );

  try {
    // Update character via API (entityId is the slug)
    const updated = await updateCharacter(entityId, values, interaction.user.id, config);

    // Update session
    if (session) {
      await sessionManager.update<CharacterData>(
        interaction.user.id,
        'character',
        entityId,
        updated
      );
    }

    // Refresh dashboard (use slug as entityId)
    const embed = buildDashboardEmbed(characterDashboardConfig, updated);
    const components = buildDashboardComponents(characterDashboardConfig, updated.slug, updated, {
      showClose: true,
      showRefresh: true,
    });

    await interaction.editReply({ embeds: [embed], components });

    logger.info({ slug: entityId, sectionId }, 'Character section updated');
  } catch (error) {
    logger.error({ err: error, entityId, sectionId }, 'Failed to update character section');
    // Since we deferred update, we can't send a new error message easily
    // The dashboard will remain in its previous state
  }
}

/**
 * Handle select menu interactions for dashboard
 */
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const config = getConfig();
  const parsed = parseDashboardCustomId(interaction.customId);
  if (parsed?.entityType !== 'character' || parsed.entityId === undefined) {
    return;
  }

  const value = interaction.values[0];
  const entityId = parsed.entityId;

  // Handle section edit selection
  if (value.startsWith('edit-')) {
    const sectionId = value.replace('edit-', '');
    const section = characterDashboardConfig.sections.find(s => s.id === sectionId);
    if (!section) {
      await interaction.reply({
        content: '❌ Unknown section.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get current data from session or fetch
    const sessionManager = getSessionManager();
    const session = await sessionManager.get<CharacterData>(
      interaction.user.id,
      'character',
      entityId
    );
    let characterData: CharacterData;

    if (session !== null) {
      characterData = session.data;
    } else {
      // Fetch fresh data (entityId is the slug)
      const character = await fetchCharacter(entityId, config, interaction.user.id);
      if (!character) {
        await interaction.reply({
          content: '❌ Character not found.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      characterData = character;
      // Create new session
      await sessionManager.set({
        userId: interaction.user.id,
        entityType: 'character',
        entityId,
        data: character,
        messageId: interaction.message.id,
        channelId: interaction.channelId,
      });
    }

    // Build and show section modal
    const modal = buildSectionModal(characterDashboardConfig, section, entityId, characterData);
    await interaction.showModal(modal);
    return;
  }

  // Handle action selection
  if (value.startsWith('action-')) {
    const actionId = value.replace('action-', '');
    await handleAction(interaction, entityId, actionId, config);
    return;
  }
}

/**
 * Handle character-specific button actions (list, view, expand, delete)
 * Returns true if handled, false if not a character button
 */
async function handleCharacterButtonAction(
  interaction: ButtonInteraction,
  config: EnvConfig
): Promise<boolean> {
  const characterParsed = CharacterCustomIds.parse(interaction.customId);
  if (!characterParsed) {
    return false;
  }

  switch (characterParsed.action) {
    case 'list':
    case 'sort': {
      if (characterParsed.page === undefined) {
        return true; // Info button is disabled, shouldn't be clickable
      }
      const page = characterParsed.action === 'sort' ? 0 : characterParsed.page;
      await handleListPagination(interaction, page, characterParsed.sort, config);
      return true;
    }

    case 'view': {
      if (characterParsed.viewPage === undefined || characterParsed.characterId === undefined) {
        return true;
      }
      await handleViewPagination(
        interaction,
        characterParsed.characterId,
        characterParsed.viewPage,
        config
      );
      return true;
    }

    case 'expand': {
      if (characterParsed.characterId === undefined || characterParsed.fieldName === undefined) {
        return true;
      }
      await handleExpandField(
        interaction,
        characterParsed.characterId,
        characterParsed.fieldName,
        config
      );
      return true;
    }

    case 'delete_confirm': {
      if (characterParsed.characterId === undefined) {
        return true;
      }
      const { handleDeleteButton } = await import('./delete.js');
      await handleDeleteButton(interaction, characterParsed.characterId, true);
      return true;
    }

    case 'delete_cancel': {
      if (characterParsed.characterId === undefined) {
        return true;
      }
      const { handleDeleteButton } = await import('./delete.js');
      await handleDeleteButton(interaction, characterParsed.characterId, false);
      return true;
    }

    default:
      return false;
  }
}

/**
 * Handle button interactions for dashboard and list pagination
 */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const config = getConfig();

  // Handle character-specific buttons (list, view, expand, delete)
  if (await handleCharacterButtonAction(interaction, config)) {
    return;
  }

  // Handle dashboard buttons
  const parsed = parseDashboardCustomId(interaction.customId);
  if (parsed?.entityType !== 'character' || parsed.entityId === undefined) {
    return;
  }

  const entityId = parsed.entityId;
  const action = parsed.action;

  if (action === 'close') {
    // Delete the session and message
    const sessionManager = getSessionManager();
    await sessionManager.delete(interaction.user.id, 'character', entityId);

    await interaction.update({
      content: '✅ Dashboard closed.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (action === 'refresh') {
    await interaction.deferUpdate();

    // Fetch fresh data (entityId is the slug)
    const character = await fetchCharacter(entityId, config, interaction.user.id);
    if (!character) {
      await interaction.editReply({
        content: '❌ Character not found.',
        embeds: [],
        components: [],
      });
      return;
    }

    // Update session
    const sessionManager = getSessionManager();
    await sessionManager.set({
      userId: interaction.user.id,
      entityType: 'character',
      entityId,
      data: character,
      messageId: interaction.message.id,
      channelId: interaction.channelId,
    });

    // Refresh dashboard (use slug as entityId)
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

    await interaction.editReply({ embeds: [embed], components });
    return;
  }
}

/**
 * Handle dashboard actions (visibility toggle, avatar upload, etc.)
 */
async function handleAction(
  interaction: StringSelectMenuInteraction,
  entityId: string,
  actionId: string,
  config: EnvConfig
): Promise<void> {
  if (actionId === 'visibility') {
    await interaction.deferUpdate();

    // Get current character (entityId is the slug)
    const character = await fetchCharacter(entityId, config, interaction.user.id);
    if (!character) {
      return;
    }

    // Toggle visibility using dedicated endpoint
    const result = await toggleVisibility(
      entityId,
      !character.isPublic,
      interaction.user.id,
      config
    );

    // Update character data with new visibility
    const updated: CharacterData = { ...character, isPublic: result.isPublic };

    // Update session
    const sessionManager = getSessionManager();
    await sessionManager.update<CharacterData>(interaction.user.id, 'character', entityId, {
      isPublic: result.isPublic,
    });

    // Refresh dashboard (use slug as entityId)
    const embed = buildDashboardEmbed(characterDashboardConfig, updated);
    const components = buildDashboardComponents(characterDashboardConfig, updated.slug, updated, {
      showClose: true,
      showRefresh: true,
    });

    await interaction.editReply({ embeds: [embed], components });

    const status = result.isPublic ? '🌐 Public' : '🔒 Private';
    logger.info({ slug: entityId, isPublic: result.isPublic }, `Character visibility: ${status}`);
    return;
  }

  if (actionId === 'avatar') {
    // Avatar upload requires a different flow - prompt user to use /character avatar command
    // or we could create a follow-up message asking them to upload an attachment
    await interaction.reply({
      content:
        '🖼️ **Avatar Upload**\n\n' +
        'Please use `/character avatar` to upload a new avatar image.\n' +
        '(Discord modals cannot accept file uploads)',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  logger.warn({ actionId }, 'Unknown action');
}

/**
 * Check if interaction is a character dashboard interaction
 */
export function isCharacterDashboardInteraction(customId: string): boolean {
  return isDashboardInteraction(customId, 'character');
}
