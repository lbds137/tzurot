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
  parseDashboardCustomId,
  isDashboardInteraction,
} from '../../utils/dashboard/index.js';
import { CharacterCustomIds } from '../../utils/customIds.js';
import {
  getCharacterDashboardConfig,
  buildCharacterDashboardOptions,
  type CharacterSessionData,
} from './config.js';
import { updateCharacter } from './api.js';
import { handleAction } from './dashboardActions.js';
import { handleSeedModalSubmit } from './create.js';
import { handleDeleteAction, handleDeleteButton } from './dashboardDeleteHandlers.js';
// Note: Browse pagination is handled in index.ts via handleBrowsePagination
import { handleViewPagination, handleExpandField } from './view.js';
import { handleBackButton, handleRefreshButton, handleCloseButton } from './dashboardButtons.js';
import {
  detectOverLengthFields,
  handleCancelEditButton,
  handleEditTruncatedButton,
  handleOpenEditorButton,
  handleViewFullButton,
  showTruncationWarning,
} from './truncationWarning.js';
import { resolveCharacterSectionContext } from './sectionContext.js';

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

  // Get the appropriate dashboard config based on admin status.
  // hasVoiceReference=false is fine here — this config is only used for
  // extractAndMergeSectionValues (section field mapping), not action rendering.
  const dashboardConfig = getCharacterDashboardConfig(isAdmin, false);

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

  // isAdmin is needed for the admin-section security check below. The
  // rest of the section context (dashboardConfig, data, DashboardContext)
  // is resolved inside resolveCharacterSectionContext so the select-menu
  // path shares its preamble with the truncation-warning button handlers.
  const isAdmin = isBotOwner(interaction.user.id);

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

    // Section lookup + data fetch are shared with the truncation-warning
    // button handlers; see sectionContext.ts. Helper sends its own
    // ephemeral error reply and returns null on failure.
    const ctx = await resolveCharacterSectionContext(interaction, entityId, sectionId, config);
    if (ctx === null) {
      return;
    }

    // Gate the modal on an informed consent when any field in the section
    // currently holds a value longer than its modal maxLength. The silent
    // truncation would otherwise happen in ModalFactory without user
    // awareness — see BACKLOG Production Issue on character field
    // silent data loss.
    const overLength = detectOverLengthFields(ctx.section, ctx.data);
    if (overLength.length > 0) {
      await showTruncationWarning(interaction, ctx.section, entityId, overLength);
      return;
    }

    // Build and show section modal (with context for field visibility)
    const modal = buildSectionModal(
      ctx.dashboardConfig,
      ctx.section,
      entityId,
      ctx.data,
      ctx.context
    );
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
    return;
  }

  // Truncation-warning flow: three buttons rendered after the user picks
  // a section containing values longer than the modal maxLength. See
  // truncationWarning.ts for the producer side. Underscored action names
  // match the existing `delete_confirm` / `delete_cancel` convention.
  const sectionId = parsed.sectionId;
  if (action === 'edit_truncated' && sectionId !== undefined) {
    await handleEditTruncatedButton(interaction, entityId, sectionId, config);
    return;
  }

  if (action === 'view_full' && sectionId !== undefined) {
    await handleViewFullButton(interaction, entityId, sectionId, config);
    return;
  }

  // `open_editor` is step 2 of the Edit-with-Truncation two-click flow.
  // The customId carries entity + section so the handler can build the
  // modal with zero pre-work (session warmed by step 1's handler).
  if (action === 'open_editor' && sectionId !== undefined) {
    await handleOpenEditorButton(interaction, entityId, sectionId, config);
    return;
  }

  if (action === 'cancel_edit') {
    await handleCancelEditButton(interaction);
  }
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
  'edit_truncated',
  'view_full',
  'open_editor',
  'cancel_edit',
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
