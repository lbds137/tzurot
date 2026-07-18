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
  type StringSelectMenuInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { buildDeleteConfirmation } from '../../utils/confirmation/confirmAction.js';
import { handleDashboardClose } from '../../utils/dashboard/closeHandler.js';
import { createRefreshHandler, refreshDashboardUI } from '../../utils/dashboard/refreshHandler.js';
import {
  extractAndMergeSectionValues,
  formatSuccessBanner,
  getSessionManager,
  requireDeferredSession,
  getSessionDataOrFollowUp,
  parseDashboardCustomId,
  isDashboardInteraction,
  renderPostActionScreen,
  handleSharedBackButton,
} from '../../utils/dashboard/index.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  PERSONA_DASHBOARD_CONFIG,
  type FlattenedPersonaData,
  flattenPersonaData,
  unflattenPersonaData,
  buildPersonaDashboardOptions,
} from './config.js';
import { fetchPersona, updatePersona, deletePersona, isDefaultPersona } from './api.js';
import { PersonaCustomIds } from '../../utils/customIds.js';
import { buildSectionModal } from '../../utils/dashboard/ModalFactory.js';
import { showModalWithTimeoutCatch } from '../../utils/dashboard/showModalWithTimeoutCatch.js';
import { buildDashboardSaveErrorContent } from '../../utils/dashboard/saveError.js';
import { detectOverLengthFields } from '../../utils/dashboard/truncationGate/index.js';
import { resolvePersonaSectionContext } from './sectionContext.js';
import {
  showTruncationWarning,
  handleEditTruncatedButton,
  handleOpenEditorButton,
  handleViewFullButton,
  handleCancelEditButton,
} from './truncationWarning.js';
// Registers the persona browse rebuilder for renderPostActionScreen +
// handleSharedBackButton. Importing the module is enough — the
// registerBrowseRebuilder call at the bottom of browse.ts runs on load.
import './browse.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';

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
    content: renderSpec(CATALOG.error.validation('Unknown form submission.')),
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

    const { userClient } = clientsFor(interaction);
    // updatePersona throws GatewayApiError on failure (caught below);
    // a resolved value is always a valid persona.
    const updatedPersona = await updatePersona(
      entityId,
      updatePayload,
      userClient,
      interaction.user.id
    );

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
    // Notify user of failure via followUp (since we deferred update). Surface the
    // real gateway message (or the honest "still applying" notice on a status-0
    // abort) instead of a generic retry prompt that masks 400 validation errors.
    await interaction.followUp({
      content: buildDashboardSaveErrorContent(error, 'persona'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle select menu interactions for dashboard.
 *
 * The select-menu customId follows `persona::menu::{personaId}` and the
 * selected value is `edit-{sectionId}`. We resolve the section context,
 * detect any over-length fields, and gate the modal behind a truncation
 * warning when present. Otherwise the modal opens directly. Mirrors the
 * character dashboard's pattern — see
 * `commands/character/dashboard.ts` `handleSelectMenu`.
 */
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  // Parse the persona-typed customId to extract personaId.
  const parsed = PersonaCustomIds.parse(interaction.customId);
  if (parsed?.personaId === undefined) {
    logger.warn({ customId: interaction.customId }, 'Unrecognized persona select menu customId');
    return;
  }
  const entityId = parsed.personaId;

  // The select value is `edit-{sectionId}`. Anything else is a no-op.
  const value = interaction.values[0];
  if (!value?.startsWith('edit-')) {
    return;
  }
  const sectionId = value.slice('edit-'.length);

  const ctx = await resolvePersonaSectionContext(interaction, entityId, sectionId);
  if (ctx === null) {
    return;
  }

  // Truncation gate: if any field's stored content exceeds its modal cap,
  // show the warning instead of opening the modal directly. The user opts
  // in via the Edit-with-Truncation button (two-click flow) before any
  // destructive truncation happens.
  const overLength = detectOverLengthFields(ctx.section, ctx.data);
  if (overLength.length > 0) {
    await showTruncationWarning(interaction, ctx.section, entityId, overLength);
    return;
  }

  // Common path: no over-length fields → open the modal directly. The
  // showModal call is wrapped via showModalWithTimeoutCatch to handle
  // the 10062 case where Redis/gateway latency + the (forbidden-by-Discord)
  // inability to deferReply before showModal blew the 3-second budget.
  const modal = buildSectionModal(ctx.dashboardConfig, ctx.section, entityId, ctx.data);
  await showModalWithTimeoutCatch(
    interaction,
    modal,
    { source: 'handleSelectMenu', userId: interaction.user.id, entityId, sectionId },
    '⏰ Took too long to open the editor. Please re-select the section from the dashboard, ' +
      'or click Refresh if the menu is no longer responsive.'
  );
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
  fetchFn: (entityId, interaction) => {
    const { userClient } = clientsFor(interaction);
    return fetchPersona(entityId, userClient, interaction.user.id);
  },
  transformFn: flattenPersonaData,
  buildOptions: buildPersonaDashboardOptions,
});

/**
 * Handle delete button - show confirmation dialog.
 */
async function handleDeleteButton(interaction: ButtonInteraction, entityId: string): Promise<void> {
  // Ack first (3-second rule): deferUpdate before the Redis session read AND the
  // gateway isDefaultPersona() call. Use the deferred session helper (followUp on
  // expiry) + followUp/editReply for the responses, since reply/update would
  // throw on the already-acked interaction.
  await interaction.deferUpdate();

  const data = await getSessionDataOrFollowUp<FlattenedPersonaData>(
    interaction,
    'persona',
    entityId
  );
  if (data === null) {
    return;
  }

  const { userClient } = clientsFor(interaction);
  const isDefault = await isDefaultPersona(entityId, userClient);
  if (isDefault) {
    await interaction.followUp({
      content: renderSpec(
        CATALOG.error.validation(
          'Cannot delete your default persona.\nUse `/persona default <other-persona>` to set a different default first.'
        )
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Show confirmation dialog using shared utility (editReply — already deferred).
  const { embed, components } = buildDeleteConfirmation({
    entityType: 'Persona',
    entityName: data.name,
    confirmCustomId: PersonaCustomIds.confirmDelete(entityId),
    cancelCustomId: PersonaCustomIds.cancelDelete(entityId),
    additionalWarning: 'Any character-specific overrides using this persona will be cleared.',
  });

  await interaction.editReply({ embeds: [embed], components });
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

  const { userClient } = clientsFor(interaction);
  const result = await deletePersona(entityId, userClient, interaction.user.id);

  if (!result.success) {
    await renderPostActionScreen({
      interaction,
      session: postActionSession,
      outcome: {
        kind: 'error',
        content: renderSpec(CATALOG.error.gatewayRejection(result.error ?? 'Delete failed')),
      },
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
    default:
      await dispatchTruncationGateAction(interaction, parsed.action, entityId, parsed.sectionId);
  }
}

/**
 * Dispatch truncation-gate button actions (`edit_truncated`, `open_editor`,
 * `view_full`, `cancel_edit`). Extracted from `handleButton` to keep its
 * cyclomatic complexity under the project's max-20 ceiling.
 *
 * `cancel_edit` is the only branch that doesn't need `sectionId`; the
 * other three log + drop if a malformed customId arrives without it,
 * so the silent-no-op case is observable in logs.
 */
async function dispatchTruncationGateAction(
  interaction: ButtonInteraction,
  action: string,
  entityId: string,
  sectionId: string | undefined
): Promise<void> {
  if (action === 'cancel_edit') {
    await handleCancelEditButton(interaction);
    return;
  }
  if (sectionId === undefined) {
    logger.warn(
      { customId: interaction.customId, action },
      'Truncation-gate action received without sectionId; dropping'
    );
    return;
  }
  switch (action) {
    case 'edit_truncated':
      await handleEditTruncatedButton(interaction, entityId, sectionId);
      break;
    case 'open_editor':
      await handleOpenEditorButton(interaction, entityId, sectionId);
      break;
    case 'view_full':
      await handleViewFullButton(interaction, entityId, sectionId);
      break;
    default:
      // Unknown action with a valid customId shape — should not happen
      // in practice (the DASHBOARD_ACTIONS Set gates the routing). Logs
      // the violation so a future drift between the Set and this switch
      // is diagnosable. Discord still shows "Interaction Failed" to the
      // user, since acking unknown actions safely needs more context
      // than this layer has.
      logger.warn(
        { customId: interaction.customId, action, entityId, sectionId },
        'Unknown truncation-gate action; dropping'
      );
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
  // Truncation gate (mirrors character dashboard).
  'edit_truncated',
  'open_editor',
  'view_full',
  'cancel_edit',
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
