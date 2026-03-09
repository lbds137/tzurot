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
import { createLogger, getConfig, isBotOwner, type EnvConfig } from '@tzurot/common-types';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildDashboardCustomId,
  buildSectionModal,
  extractAndMergeSectionValues,
  getSessionManager,
  fetchOrCreateSession,
  parseDashboardCustomId,
  isDashboardInteraction,
  type DashboardContext,
} from '../../utils/dashboard/index.js';
import { DASHBOARD_MESSAGES } from '../../utils/dashboard/messages.js';
import { CharacterCustomIds } from '../../utils/customIds.js';
import {
  getCharacterDashboardConfig,
  buildCharacterDashboardOptions,
  type CharacterData,
  type CharacterSessionData,
} from './config.js';
import { fetchCharacter, updateCharacter, toggleVisibility } from './api.js';
import { handleSeedModalSubmit } from './create.js';
import { handleDeleteAction, handleDeleteButton } from './dashboardDeleteHandlers.js';
// Note: Browse pagination is handled in index.ts via handleBrowsePagination
import { handleViewPagination, handleExpandField } from './view.js';
import { handleBackButton, handleRefreshButton, handleCloseButton } from './dashboardButtons.js';

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

  // SECURITY: Re-verify admin status for admin section edits
  // Never trust session data - always check server-side
  const isAdmin = isBotOwner(interaction.user.id);
  if (sectionId === 'admin' && !isAdmin) {
    logger.warn(
      { userId: interaction.user.id, entityId, sectionId },
      'Non-admin attempted admin section edit'
    );
    // Silently ignore - the section shouldn't have been visible to non-admins
    return;
  }

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<CharacterSessionData>(
    interaction.user.id,
    'character',
    entityId
  );

  if (session === null) {
    // Session expired - try to refresh data and continue
    logger.warn({ entityId, sectionId }, 'Session not found for modal submit');
  }

  // Get the appropriate dashboard config based on admin status
  const dashboardConfig = getCharacterDashboardConfig(isAdmin);

  // Extract and merge modal values with session data
  const extracted = extractAndMergeSectionValues(
    interaction,
    dashboardConfig,
    sectionId,
    session?.data ?? {}
  );
  if (extracted === null) {
    return;
  }

  try {
    // Update character via API (entityId is the slug)
    const updated = await updateCharacter(entityId, extracted.merged, interaction.user.id, config);

    // Build session data (preserve _isAdmin flag and browseContext)
    const sessionData: CharacterSessionData = {
      ...updated,
      _isAdmin: isAdmin,
      browseContext: session?.data?.browseContext, // Preserve browse context for back button
    };

    // Update session if it exists
    if (session) {
      await sessionManager.update<CharacterSessionData>(
        interaction.user.id,
        'character',
        entityId,
        sessionData
      );
    }

    // Rebuild config with updated hasVoiceReference for conditional actions
    const refreshConfig = getCharacterDashboardConfig(isAdmin, updated.hasVoiceReference);
    const embed = buildDashboardEmbed(refreshConfig, updated);
    const components = buildDashboardComponents(
      refreshConfig,
      updated.slug,
      updated,
      buildCharacterDashboardOptions(sessionData)
    );

    await interaction.editReply({ embeds: [embed], components });

    logger.info({ slug: entityId, sectionId, isAdmin }, 'Character section updated');
  } catch (error) {
    logger.error({ err: error, entityId, sectionId }, 'Failed to update character section');
    // Notify user of failure via followUp (since we deferred update)
    await interaction.followUp({
      content: '❌ Failed to update character. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
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

  // Determine admin status for context-aware features
  const isAdmin = isBotOwner(interaction.user.id);
  const dashboardConfig = getCharacterDashboardConfig(isAdmin);
  const context: DashboardContext = { isAdmin, userId: interaction.user.id };

  // Handle section edit selection
  if (value.startsWith('edit-')) {
    const sectionId = value.replace('edit-', '');

    // SECURITY: Block non-admins from admin section
    if (sectionId === 'admin' && !isAdmin) {
      logger.warn(
        { userId: interaction.user.id, entityId, sectionId },
        'Non-admin attempted to select admin section'
      );
      await interaction.reply({
        content: '❌ This section is restricted to bot administrators.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const section = dashboardConfig.sections.find(s => s.id === sectionId);
    if (!section) {
      await interaction.reply({
        content: '❌ Unknown section.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get current data from session or fetch from API
    const result = await fetchOrCreateSession<CharacterSessionData, CharacterData>({
      userId: interaction.user.id,
      entityType: 'character',
      entityId,
      fetchFn: () => fetchCharacter(entityId, config, interaction.user.id),
      transformFn: (character: CharacterData) => ({ ...character, _isAdmin: isAdmin }),
      interaction,
    });
    if (!result.success) {
      await interaction.reply({
        content: DASHBOARD_MESSAGES.NOT_FOUND('Character'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Build and show section modal (with context for field visibility)
    const modal = buildSectionModal(dashboardConfig, section, entityId, result.data, context);
    await interaction.showModal(modal);
    return;
  }

  // Handle action selection
  if (value.startsWith('action-')) {
    const actionId = value.replace('action-', '');
    await handleAction(interaction, entityId, actionId, config);
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
    // Note: 'list' and 'sort' cases removed - browse pagination handled in index.ts

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
      await handleDeleteButton(interaction, characterParsed.characterId, true);
      return true;
    }

    case 'delete_cancel': {
      if (characterParsed.characterId === undefined) {
        return true;
      }
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
    await handleCloseButton(interaction, entityId);
    return;
  }

  if (action === 'back') {
    await handleBackButton(interaction, entityId);
    return;
  }

  if (action === 'refresh') {
    await handleRefreshButton(interaction, entityId);
    return;
  }

  if (action === 'delete') {
    await handleDeleteAction(interaction, entityId, config);
  }
}

/**
 * Refresh the dashboard after a character update.
 * Handles session preservation and dashboard rebuild.
 */
async function refreshDashboardAfterUpdate(
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
    canEdit: session?.data?.canEdit,
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
 * Handle dashboard actions (visibility toggle, avatar upload, voice, etc.)
 */
async function handleAction(
  interaction: StringSelectMenuInteraction,
  entityId: string,
  actionId: string,
  config: EnvConfig
): Promise<void> {
  if (actionId === 'visibility') {
    await interaction.deferUpdate();

    const character = await fetchCharacter(entityId, config, interaction.user.id);
    if (!character) {
      return;
    }

    const result = await toggleVisibility(
      entityId,
      !character.isPublic,
      interaction.user.id,
      config
    );

    const updated: CharacterData = { ...character, isPublic: result.isPublic };
    await refreshDashboardAfterUpdate(interaction, entityId, updated);

    const status = result.isPublic ? '🌐 Public' : '🔒 Private';
    logger.info({ slug: entityId, isPublic: result.isPublic }, `Character visibility: ${status}`);
    return;
  }

  if (actionId === 'avatar') {
    await interaction.reply({
      content:
        '🖼️ **Avatar Upload**\n\n' +
        'Please use `/character avatar` to upload a new avatar image.\n' +
        '(Discord modals cannot accept file uploads)',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (actionId === 'voice') {
    await interaction.reply({
      content:
        '🎤 **Voice Reference**\n\n' +
        'Use `/character voice` to upload a voice reference for TTS cloning.\n' +
        'Use `/character voice-clear` to remove it and disable TTS.\n' +
        '(Discord modals cannot accept file uploads)',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (actionId === 'voice-toggle') {
    await interaction.deferUpdate();

    const character = await fetchCharacter(entityId, config, interaction.user.id);
    if (!character) {
      return;
    }

    const newVoiceEnabled = !character.voiceEnabled;
    const updated = await updateCharacter(
      entityId,
      { voiceEnabled: newVoiceEnabled },
      interaction.user.id,
      config
    );

    await refreshDashboardAfterUpdate(interaction, entityId, updated);

    const status = newVoiceEnabled ? '🔊 Enabled' : '🔇 Disabled';
    logger.info({ slug: entityId, voiceEnabled: newVoiceEnabled }, `Character voice: ${status}`);
    return;
  }

  logger.warn({ actionId }, 'Unknown action');
}

/** Dashboard-specific actions that this handler manages */
const DASHBOARD_ACTIONS = new Set([
  'menu',
  'modal',
  'close',
  'refresh',
  'back',
  'delete',
  'delete_confirm',
  'delete_cancel',
]);

/**
 * Check if interaction is a character dashboard interaction.
 * Only matches dashboard-specific actions, not all character:: customIds.
 */
export function isCharacterDashboardInteraction(customId: string): boolean {
  // Must start with character::
  if (!isDashboardInteraction(customId, 'character')) {
    return false;
  }

  // Parse to check the action
  const parsed = CharacterCustomIds.parse(customId);
  if (parsed === null) {
    return false;
  }

  // Only return true for dashboard-specific actions
  return DASHBOARD_ACTIONS.has(parsed.action);
}
