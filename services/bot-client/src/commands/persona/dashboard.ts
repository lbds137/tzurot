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
import { createRefreshHandler, refreshDashboardUI } from '../../utils/dashboard/refreshHandler.js';
import {
  extractAndMergeSectionValues,
  formatSuccessBanner,
  getSessionManager,
  requireDeferredSession,
  getSessionDataOrReply,
  parseDashboardCustomId,
  isDashboardInteraction,
  renderPostActionScreen,
  handleSharedBackButton,
} from '../../utils/dashboard/index.js';
import { handleDashboardSectionSelect } from '../../utils/dashboard/genericSelectMenuHandler.js';
import { toGatewayUser } from '../../utils/userGatewayClient.js';
import {
  PERSONA_DASHBOARD_CONFIG,
  type FlattenedPersonaData,
  flattenPersonaData,
  unflattenPersonaData,
  buildPersonaDashboardOptions,
} from './config.js';
import type { PersonaDetails } from './types.js';
import { fetchPersona, updatePersona, deletePersona, isDefaultPersona } from './api.js';
import { PersonaCustomIds } from '../../utils/customIds.js';
// Registers the persona browse rebuilder for renderPostActionScreen +
// handleSharedBackButton. Importing the module is enough — the
// registerBrowseRebuilder call at the bottom of browse.ts runs on load.
import './browse.js';

const logger = createLogger('persona-dashboard');
const BROWSE_COMMAND = '/persona browse';

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

  // Extract and merge modal values with session data
  const extracted = extractAndMergeSectionValues(
    interaction,
    PERSONA_DASHBOARD_CONFIG,
    sectionId,
    session?.data ?? {}
  );
  if (extracted === null) {
    return;
  }

  try {
    // Convert to API format
    const updatePayload = unflattenPersonaData(extracted.merged);

    // Update persona via API
    const updatedPersona = await updatePersona(
      entityId,
      updatePayload,
      toGatewayUser(interaction.user)
    );

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
    await refreshDashboardUI({
      interaction,
      entityId,
      data: flattenedData,
      dashboardConfig: PERSONA_DASHBOARD_CONFIG,
      buildOptions: buildPersonaDashboardOptions,
    });

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
  await handleDashboardSectionSelect<FlattenedPersonaData, PersonaDetails>(interaction, {
    entityType: 'persona',
    dashboardConfig: PERSONA_DASHBOARD_CONFIG,
    fetchFn: (entityId, user) => fetchPersona(entityId, user),
    transformFn: flattenPersonaData,
    entityName: 'Persona',
  });
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
  const isDefault = await isDefaultPersona(entityId, toGatewayUser(interaction.user));
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
 *
 * Routes success through `renderPostActionScreen` so the dashboard is
 * replaced with the refreshed browse list (banner in `content`) when the
 * user came from `/persona browse`, or a clean terminal otherwise. Error
 * paths render as a terminal screen with Back-to-Browse where applicable.
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

  const postActionSession = {
    userId: interaction.user.id,
    entityType: 'persona' as const,
    entityId,
    browseContext: session?.data.browseContext,
  };

  const result = await deletePersona(entityId, toGatewayUser(interaction.user));

  if (!result.success) {
    await renderPostActionScreen({
      interaction,
      session: postActionSession,
      outcome: { kind: 'error', content: `❌ Failed to delete persona: ${result.error}` },
    });
    return;
  }

  await renderPostActionScreen({
    interaction,
    session: postActionSession,
    outcome: { kind: 'success', banner: formatSuccessBanner('Deleted persona', personaName) },
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
  const session = await requireDeferredSession<FlattenedPersonaData>(
    interaction,
    'persona',
    entityId,
    BROWSE_COMMAND
  );
  if (session === null) {
    return;
  }

  // Refresh dashboard to return from confirmation view
  await refreshDashboardUI({
    interaction,
    entityId,
    data: session.data,
    dashboardConfig: PERSONA_DASHBOARD_CONFIG,
    buildOptions: buildPersonaDashboardOptions,
  });
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
      await interaction.deferUpdate();
      await handleSharedBackButton(interaction, 'persona', entityId);
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
