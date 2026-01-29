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
import {
  createLogger,
  getConfig,
  isBotOwner,
  DeletePersonalityResponseSchema,
  type EnvConfig,
} from '@tzurot/common-types';
import { buildDeleteConfirmation } from '../../utils/dashboard/deleteConfirmation.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildDashboardCustomId,
  buildSectionModal,
  extractModalValues,
  getSessionManager,
  parseDashboardCustomId,
  isDashboardInteraction,
  type DashboardContext,
} from '../../utils/dashboard/index.js';
import { DASHBOARD_MESSAGES } from '../../utils/dashboard/messages.js';
import { CharacterCustomIds } from '../../utils/customIds.js';
import { getCharacterDashboardConfig, type CharacterData } from './config.js';
import type { CharacterSessionData } from './edit.js';
import { fetchCharacter, updateCharacter, toggleVisibility } from './api.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { handleSeedModalSubmit } from './create.js';
// Note: Browse pagination is handled in index.ts via handleBrowsePagination
import { handleViewPagination, handleExpandField } from './view.js';
import {
  handleBackButton,
  handleRefreshButton,
  handleCloseButton,
  buildCharacterDashboardOptions,
} from './dashboardButtons.js';

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

  // Find the section config
  const section = dashboardConfig.sections.find(s => s.id === sectionId);
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

    // Refresh dashboard using shared options builder
    const embed = buildDashboardEmbed(dashboardConfig, updated);
    const components = buildDashboardComponents(
      dashboardConfig,
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

    // Get current data from session or fetch
    const sessionManager = getSessionManager();
    const session = await sessionManager.get<CharacterSessionData>(
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
          content: DASHBOARD_MESSAGES.NOT_FOUND('Character'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      characterData = character;
      // Create new session (with admin flag)
      const sessionData: CharacterSessionData = { ...character, _isAdmin: isAdmin };
      await sessionManager.set({
        userId: interaction.user.id,
        entityType: 'character',
        entityId,
        data: sessionData,
        messageId: interaction.message.id,
        channelId: interaction.channelId,
      });
    }

    // Build and show section modal (with context for field visibility)
    const modal = buildSectionModal(dashboardConfig, section, entityId, characterData, context);
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
    return;
  }
}

/**
 * Handle delete button click from dashboard - show confirmation dialog
 */
async function handleDeleteAction(
  interaction: ButtonInteraction,
  slug: string,
  config: EnvConfig
): Promise<void> {
  // Re-fetch to verify current state and permissions
  const character = await fetchCharacter(slug, config, interaction.user.id);
  if (!character) {
    await interaction.reply({
      content: DASHBOARD_MESSAGES.NOT_FOUND('Character'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Verify user can delete
  if (!character.canEdit) {
    await interaction.reply({
      content: DASHBOARD_MESSAGES.NO_PERMISSION('delete this character'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Build confirmation dialog using shared utility
  const displayName = character.displayName ?? character.name;
  const { embed, components } = buildDeleteConfirmation({
    entityType: 'Character',
    entityName: displayName,
    confirmCustomId: CharacterCustomIds.deleteConfirm(slug),
    cancelCustomId: CharacterCustomIds.deleteCancel(slug),
    title: '⚠️ Delete Character?',
    confirmLabel: 'Delete Forever',
    deletedItems: [
      'Conversation history',
      'Long-term memories',
      'Pending memories',
      'Activated channels',
      'Aliases',
      'Cached avatar',
    ],
  });

  await interaction.update({ embeds: [embed], components });

  logger.info({ userId: interaction.user.id, slug }, 'Showing delete confirmation from dashboard');
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

    // Determine admin status for dashboard config
    const isAdmin = isBotOwner(interaction.user.id);
    const dashboardConfig = getCharacterDashboardConfig(isAdmin);

    // Get session to check for browse context and build session data
    const sessionManager = getSessionManager();
    const session = await sessionManager.get<CharacterSessionData>(
      interaction.user.id,
      'character',
      entityId
    );

    // Build session data with preserved browse context
    const sessionData: CharacterSessionData = {
      ...updated,
      canEdit: session?.data?.canEdit, // Preserve canEdit from original session
      _isAdmin: isAdmin,
      browseContext: session?.data?.browseContext, // Preserve browse context
    };

    // Update session
    await sessionManager.update<CharacterSessionData>(
      interaction.user.id,
      'character',
      entityId,
      sessionData
    );

    // Refresh dashboard using shared options builder
    const embed = buildDashboardEmbed(dashboardConfig, updated);
    const components = buildDashboardComponents(
      dashboardConfig,
      updated.slug,
      updated,
      buildCharacterDashboardOptions(sessionData)
    );

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
 * Handle delete confirmation button click
 * Called when user clicks "Delete Forever" or "Cancel" on the delete confirmation dialog
 */
async function handleDeleteButton(
  interaction: ButtonInteraction,
  slug: string,
  confirmed: boolean
): Promise<void> {
  if (!confirmed) {
    await interaction.update({
      content: '✅ Deletion cancelled.',
      embeds: [],
      components: [],
    });
    return;
  }

  // User clicked confirm - proceed with deletion
  await interaction.update({
    content: '🔄 Deleting character...',
    embeds: [],
    components: [],
  });

  // Call the DELETE API
  const result = await callGatewayApi<unknown>(`/user/personality/${slug}`, {
    method: 'DELETE',
    userId: interaction.user.id,
  });

  if (!result.ok) {
    logger.error({ slug, error: result.error }, '[Character] Delete API failed');
    await interaction.editReply({
      content: `❌ Failed to delete character: ${result.error}`,
      embeds: [],
      components: [],
    });
    return;
  }

  // Validate response against schema (contract validation)
  const parseResult = DeletePersonalityResponseSchema.safeParse(result.data);
  if (!parseResult.success) {
    logger.error(
      { slug, parseError: parseResult.error.message },
      '[Character] Response schema validation failed'
    );
    // Still consider it a success since the API returned 200
    await interaction.editReply({
      content: `✅ Character has been deleted.`,
      embeds: [],
      components: [],
    });
    return;
  }

  const { deletedCounts: counts, deletedName, deletedSlug } = parseResult.data;

  // Build success message with deletion counts (filter out zero counts)
  const countLines = [
    counts.conversationHistory > 0 && `• ${counts.conversationHistory} conversation message(s)`,
    counts.memories > 0 &&
      `• ${counts.memories} long-term memor${counts.memories === 1 ? 'y' : 'ies'}`,
    counts.pendingMemories > 0 &&
      `• ${counts.pendingMemories} pending memor${counts.pendingMemories === 1 ? 'y' : 'ies'}`,
    counts.channelSettings > 0 && `• ${counts.channelSettings} channel setting(s)`,
    counts.aliases > 0 && `• ${counts.aliases} alias(es)`,
  ].filter((line): line is string => typeof line === 'string');

  let successMessage = `✅ Character \`${deletedName}\` has been permanently deleted.`;
  if (countLines.length > 0) {
    successMessage += '\n\n**Deleted data:**\n' + countLines.join('\n');
  }

  await interaction.editReply({
    content: successMessage,
    embeds: [],
    components: [],
  });

  logger.info(
    { userId: interaction.user.id, slug: deletedSlug, counts },
    '[Character] Successfully deleted character'
  );
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
