/**
 * Persona Dashboard Interaction Handlers
 *
 * Handles all dashboard interactions:
 * - Select menu for editing sections
 * - Button clicks (close, refresh, delete)
 * - Modal submissions for section edits
 */

import { MessageFlags } from 'discord.js';
import type {
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { buildDeleteConfirmation } from '../../utils/dashboard/deleteConfirmation.js';
import { handleDashboardClose } from '../../utils/dashboard/closeHandler.js';
import { createRefreshHandler } from '../../utils/dashboard/refreshHandler.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildSectionModal,
  extractModalValues,
  getSessionManager,
  getSessionOrExpired,
  getSessionDataOrReply,
  parseDashboardCustomId,
  isDashboardInteraction,
  DASHBOARD_MESSAGES,
  formatSessionExpiredMessage,
  type ActionButtonOptions,
} from '../../utils/dashboard/index.js';
import {
  PERSONA_DASHBOARD_CONFIG,
  type FlattenedPersonaData,
  flattenPersonaData,
  unflattenPersonaData,
} from './config.js';
import { fetchPersona, updatePersona, deletePersona, isDefaultPersona } from './api.js';
import { PersonaCustomIds, type PersonaBrowseSortType } from '../../utils/customIds.js';
import { buildBrowseResponse } from './browse.js';

const logger = createLogger('persona-dashboard');

/**
 * Build dashboard button options for personas.
 * Delete button only shown for non-default personas.
 * Back button shown when opened from browse (preserves navigation context).
 */
function buildPersonaDashboardOptions(data: FlattenedPersonaData): ActionButtonOptions {
  const hasBackContext = data.browseContext !== undefined;
  return {
    showClose: !hasBackContext, // Only show close if not from browse
    showBack: hasBackContext, // Show back if opened from browse
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

    // Preserve browseContext from original session for back button support
    if (session?.data?.browseContext) {
      flattenedData.browseContext = session.data.browseContext;
    }

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
    // Notify user of failure via followUp (since we deferred update)
    await interaction.followUp({
      content: '❌ Failed to update persona. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
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
          content: DASHBOARD_MESSAGES.NOT_FOUND('Persona'),
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
 * Handle close button using shared handler
 */
async function handleCloseButton(interaction: ButtonInteraction, entityId: string): Promise<void> {
  await handleDashboardClose(interaction, 'persona', entityId);
}

/**
 * Handle refresh button using shared handler
 */
const handleRefreshButton = createRefreshHandler({
  entityType: 'persona',
  dashboardConfig: PERSONA_DASHBOARD_CONFIG,
  fetchFn: fetchPersona,
  transformFn: flattenPersonaData,
  buildOptions: buildPersonaDashboardOptions,
});

/**
 * Handle delete button - show confirmation dialog.
 */
async function handleDeleteButton(interaction: ButtonInteraction, entityId: string): Promise<void> {
  // Get session data or show expired message
  const data = await getSessionDataOrReply<FlattenedPersonaData>(interaction, 'persona', entityId);
  if (data === null) {
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

  // Show confirmation dialog using shared utility
  const { embed, components } = buildDeleteConfirmation({
    entityType: 'Persona',
    entityName: data.name,
    confirmCustomId: PersonaCustomIds.confirmDelete(entityId),
    cancelCustomId: PersonaCustomIds.cancelDelete(entityId),
    additionalWarning: 'Any personality-specific overrides using this persona will be cleared.',
  });

  await interaction.update({ embeds: [embed], components });
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

  // Get session or show expired message
  const session = await getSessionOrExpired<FlattenedPersonaData>(
    interaction,
    'persona',
    entityId,
    '/persona browse'
  );
  if (session === null) {
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
      await handleBackButton(interaction, entityId);
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
 */
async function handleBackButton(interaction: ButtonInteraction, entityId: string): Promise<void> {
  await interaction.deferUpdate();

  // Get session or show expired message
  const session = await getSessionOrExpired<FlattenedPersonaData>(
    interaction,
    'persona',
    entityId,
    '/persona browse'
  );
  if (session === null) {
    return;
  }

  const browseContext = session.data.browseContext;
  if (!browseContext) {
    // Session exists but no browse context - shouldn't happen, show expired
    await interaction.editReply({
      content: formatSessionExpiredMessage('/persona browse'),
      embeds: [],
      components: [],
    });
    return;
  }

  try {
    const result = await buildBrowseResponse(
      interaction.user.id,
      browseContext.page,
      browseContext.sort as PersonaBrowseSortType
    );

    if (result === null) {
      await interaction.editReply({
        content: '❌ Failed to load browse list. Please try again.',
        embeds: [],
        components: [],
      });
      return;
    }

    // Clean up the dashboard session
    const sessionManager = getSessionManager();
    await sessionManager.delete(interaction.user.id, 'persona', entityId);

    await interaction.editReply({
      embeds: [result.embed],
      components: result.components,
    });

    logger.info({ userId: interaction.user.id }, '[Persona] Returned to browse from dashboard');
  } catch (error) {
    logger.error({ err: error }, '[Persona] Failed to return to browse');
    await interaction.editReply({
      content: '❌ Failed to load browse list. Please try again.',
      embeds: [],
      components: [],
    });
  }
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
