/**
 * Persona Dashboard Interaction Handlers
 *
 * Handles all dashboard interactions:
 * - Select menu for editing sections
 * - Button clicks (close, refresh, delete)
 * - Modal submissions for section edits
 */

import {
  MessageFlags,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} from 'discord.js';
import type {
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildSectionModal,
  extractModalValues,
  getSessionManager,
  parseDashboardCustomId,
  isDashboardInteraction,
  type ActionButtonOptions,
} from '../../utils/dashboard/index.js';
import {
  PERSONA_DASHBOARD_CONFIG,
  type FlattenedPersonaData,
  flattenPersonaData,
  unflattenPersonaData,
} from './config.js';
import { fetchPersona, updatePersona, deletePersona, isDefaultPersona } from './api.js';
import { PersonaCustomIds } from '../../utils/customIds.js';

const logger = createLogger('persona-dashboard');

/**
 * Build dashboard button options for personas.
 * Delete button only shown for non-default personas.
 */
function buildPersonaDashboardOptions(data: FlattenedPersonaData): ActionButtonOptions {
  return {
    showClose: true,
    showRefresh: true,
    showDelete: !data.isDefault, // Can't delete default persona
  };
}

/**
 * Refresh the dashboard UI with updated data.
 */
async function refreshDashboardUI(
  interaction: ModalSubmitInteraction | ButtonInteraction,
  entityId: string,
  flattenedData: FlattenedPersonaData
): Promise<void> {
  const embed = buildDashboardEmbed(PERSONA_DASHBOARD_CONFIG, flattenedData);
  const components = buildDashboardComponents(
    PERSONA_DASHBOARD_CONFIG,
    entityId,
    flattenedData,
    buildPersonaDashboardOptions(flattenedData)
  );
  await interaction.editReply({ embeds: [embed], components });
}

/**
 * Handle modal submissions for persona editing
 */
export async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const customId = interaction.customId;
  const parsed = parseDashboardCustomId(customId);

  // Handle section edit modals
  // Format: persona::modal::{entityId}::{sectionId}
  if (
    parsed?.entityType === 'persona' &&
    parsed.action === 'modal' &&
    parsed.entityId !== undefined &&
    parsed.sectionId !== undefined
  ) {
    await handleSectionModalSubmit(interaction, parsed.entityId, parsed.sectionId);
    return;
  }

  logger.warn({ customId }, 'Unknown persona modal submission');
  await interaction.reply({
    content: '❌ Unknown form submission.',
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Handle section modal submission - update persona field
 */
async function handleSectionModalSubmit(
  interaction: ModalSubmitInteraction,
  entityId: string,
  sectionId: string
): Promise<void> {
  await interaction.deferUpdate();

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<FlattenedPersonaData>(
    interaction.user.id,
    'persona',
    entityId
  );

  if (session === null) {
    logger.warn({ entityId, sectionId }, 'Session not found for modal submit');
  }

  // Find the section config
  const section = PERSONA_DASHBOARD_CONFIG.sections.find(s => s.id === sectionId);
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
    // Merge with existing session data to preserve other fields
    const currentData = session?.data ?? {};
    const mergedFlat = { ...currentData, ...values } as Partial<FlattenedPersonaData>;

    // Convert to API format
    const updatePayload = unflattenPersonaData(mergedFlat);

    // Update persona via API
    const updatedPersona = await updatePersona(entityId, updatePayload, interaction.user.id);

    if (!updatedPersona) {
      await interaction.followUp({
        content: '❌ Failed to save persona. Please try again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Flatten the response for dashboard display
    const flattenedData = flattenPersonaData(updatedPersona);

    // Update session
    if (session) {
      await sessionManager.update<FlattenedPersonaData>(
        interaction.user.id,
        'persona',
        entityId,
        flattenedData
      );
    }

    // Refresh dashboard
    await refreshDashboardUI(interaction, entityId, flattenedData);

    logger.info({ personaId: entityId, sectionId }, 'Persona section updated');
  } catch (error) {
    logger.error({ err: error, entityId, sectionId }, 'Failed to update persona section');
    // Dashboard will remain in its previous state since we deferred
  }
}

/**
 * Handle select menu interactions for dashboard
 */
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const parsed = parseDashboardCustomId(interaction.customId);
  if (parsed?.entityType !== 'persona' || parsed.entityId === undefined) {
    return;
  }

  const value = interaction.values[0];
  const entityId = parsed.entityId;

  // Handle section edit selection
  if (value.startsWith('edit-')) {
    const sectionId = value.replace('edit-', '');
    const section = PERSONA_DASHBOARD_CONFIG.sections.find(s => s.id === sectionId);
    if (!section) {
      await interaction.reply({
        content: '❌ Unknown section.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get current data from session or fetch
    const sessionManager = getSessionManager();
    const session = await sessionManager.get<FlattenedPersonaData>(
      interaction.user.id,
      'persona',
      entityId
    );
    let personaData: FlattenedPersonaData;

    if (session !== null) {
      personaData = session.data;
    } else {
      // Fetch fresh data
      const persona = await fetchPersona(entityId, interaction.user.id);
      if (!persona) {
        await interaction.reply({
          content: '❌ Persona not found.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      personaData = flattenPersonaData(persona);
      // Create new session
      await sessionManager.set({
        userId: interaction.user.id,
        entityType: 'persona',
        entityId,
        data: personaData,
        messageId: interaction.message.id,
        channelId: interaction.channelId,
      });
    }

    // Build and show section modal
    const modal = buildSectionModal<FlattenedPersonaData>(
      PERSONA_DASHBOARD_CONFIG,
      section,
      entityId,
      personaData
    );
    await interaction.showModal(modal);
    return;
  }
}

/**
 * Handle close button - delete session and close dashboard.
 */
async function handleCloseButton(interaction: ButtonInteraction, entityId: string): Promise<void> {
  const sessionManager = getSessionManager();
  await sessionManager.delete(interaction.user.id, 'persona', entityId);

  await interaction.update({
    content: '✅ Dashboard closed.',
    embeds: [],
    components: [],
  });
}

/**
 * Handle refresh button - fetch fresh data and update dashboard.
 */
async function handleRefreshButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  await interaction.deferUpdate();

  const persona = await fetchPersona(entityId, interaction.user.id);

  if (!persona) {
    await interaction.editReply({
      content: '❌ Persona not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const flattenedData = flattenPersonaData(persona);

  const sessionManager = getSessionManager();
  await sessionManager.set({
    userId: interaction.user.id,
    entityType: 'persona',
    entityId,
    data: flattenedData,
    messageId: interaction.message.id,
    channelId: interaction.channelId,
  });

  await refreshDashboardUI(interaction, entityId, flattenedData);
}

/**
 * Handle delete button - show confirmation dialog.
 */
async function handleDeleteButton(interaction: ButtonInteraction, entityId: string): Promise<void> {
  const sessionManager = getSessionManager();
  const session = await sessionManager.get<FlattenedPersonaData>(
    interaction.user.id,
    'persona',
    entityId
  );

  if (!session) {
    await interaction.reply({
      content: '❌ Session expired. Please reopen the dashboard.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if this is the default persona
  const isDefault = await isDefaultPersona(entityId, interaction.user.id);
  if (isDefault) {
    await interaction.reply({
      content:
        '❌ Cannot delete your default persona.\n\n' +
        'Use `/persona default <other-persona>` to set a different default first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Show confirmation dialog
  const confirmEmbed = new EmbedBuilder()
    .setTitle('🗑️ Delete Persona?')
    .setDescription(
      `Are you sure you want to delete **${session.data.name}**?\n\n` +
        'This action cannot be undone. Any personality-specific overrides using this persona will be cleared.'
    )
    .setColor(DISCORD_COLORS.WARNING);

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(PersonaCustomIds.cancelDelete(entityId))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(PersonaCustomIds.confirmDelete(entityId))
      .setLabel('Delete')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️')
  );

  await interaction.update({
    embeds: [confirmEmbed],
    components: [confirmRow],
  });
}

/**
 * Handle confirm-delete button - actually delete the persona.
 */
async function handleConfirmDeleteButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  await interaction.deferUpdate();

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<FlattenedPersonaData>(
    interaction.user.id,
    'persona',
    entityId
  );

  const personaName = session?.data.name ?? 'Persona';

  const result = await deletePersona(entityId, interaction.user.id);

  if (!result.success) {
    await interaction.editReply({
      content: `❌ Failed to delete persona: ${result.error}`,
      embeds: [],
      components: [],
    });
    return;
  }

  // Clean up session
  await sessionManager.delete(interaction.user.id, 'persona', entityId);

  // Show success
  await interaction.editReply({
    content: `✅ **${personaName}** has been deleted.`,
    embeds: [],
    components: [],
  });

  logger.info({ userId: interaction.user.id, entityId, personaName }, 'Persona deleted');
}

/**
 * Handle cancel-delete button - return to dashboard.
 */
async function handleCancelDeleteButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  await interaction.deferUpdate();

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<FlattenedPersonaData>(
    interaction.user.id,
    'persona',
    entityId
  );

  if (!session) {
    await interaction.editReply({
      content: '❌ Session expired. Please reopen the dashboard.',
      embeds: [],
      components: [],
    });
    return;
  }

  // Refresh dashboard to return from confirmation view
  await refreshDashboardUI(interaction, entityId, session.data);
}

/**
 * Handle button interactions for dashboard
 */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = PersonaCustomIds.parse(interaction.customId);
  if (parsed === null) {
    // Fall back to dashboard parsing for standard actions
    const dashboardParsed = parseDashboardCustomId(interaction.customId);
    if (dashboardParsed?.entityType !== 'persona' || dashboardParsed.entityId === undefined) {
      return;
    }

    const entityId = dashboardParsed.entityId;
    const action = dashboardParsed.action;

    switch (action) {
      case 'close':
        await handleCloseButton(interaction, entityId);
        break;
      case 'refresh':
        await handleRefreshButton(interaction, entityId);
        break;
      case 'delete':
        await handleDeleteButton(interaction, entityId);
        break;
    }
    return;
  }

  const entityId = parsed.personaId;
  if (entityId === undefined) {
    return;
  }

  switch (parsed.action) {
    case 'close':
      await handleCloseButton(interaction, entityId);
      break;
    case 'back':
      await handleBackButton(interaction);
      break;
    case 'refresh':
      await handleRefreshButton(interaction, entityId);
      break;
    case 'delete':
      await handleDeleteButton(interaction, entityId);
      break;
    case 'confirm-delete':
      await handleConfirmDeleteButton(interaction, entityId);
      break;
    case 'cancel-delete':
      await handleCancelDeleteButton(interaction, entityId);
      break;
  }
}

/**
 * Handle back button - return to browse list
 *
 * NOTE: Currently shows expired message since browse context isn't stored.
 * This is a known limitation - see BACKLOG item for slash command UX improvements.
 */
async function handleBackButton(interaction: ButtonInteraction): Promise<void> {
  // Without browse context stored in the session, we can't restore the exact browse state.
  // Show a helpful message directing the user to re-run the command.
  await interaction.reply({
    content: '⏰ Session expired. Please run `/persona browse` again to return to the list.',
    flags: MessageFlags.Ephemeral,
  });
}

/** Dashboard-specific actions that this handler manages */
const DASHBOARD_ACTIONS = new Set([
  'menu',
  'modal',
  'close',
  'refresh',
  'delete',
  'confirm-delete',
  'cancel-delete',
  'back',
]);

/**
 * Check if interaction is a persona dashboard interaction.
 * Only matches dashboard-specific actions, not all persona:: customIds.
 */
export function isPersonaDashboardInteraction(customId: string): boolean {
  // Must start with persona::
  if (!isDashboardInteraction(customId, 'persona')) {
    return false;
  }

  // Parse to check the action
  const parsed = PersonaCustomIds.parse(customId);
  if (parsed === null) {
    return false;
  }

  // Only return true for dashboard-specific actions
  return DASHBOARD_ACTIONS.has(parsed.action);
}
