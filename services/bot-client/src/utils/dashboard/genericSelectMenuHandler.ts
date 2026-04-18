/**
 * Generic Dashboard Select Menu Handler
 *
 * Handles the "edit section" select menu flow shared by persona and preset
 * dashboards. Both flows follow the same pattern:
 * 1. Parse the custom ID and guard on entity type
 * 2. Look up the section config
 * 3. Fetch or create the session
 * 4. Optionally verify edit permission
 * 5. Build and show the section modal
 *
 * Extracted from persona/dashboard.ts and preset/dashboard.ts which had
 * nearly-identical 47-line handleSelectMenu functions.
 */

import type { StringSelectMenuInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { toGatewayUser, type GatewayUser } from '../userGatewayClient.js';
import { parseDashboardCustomId, type DashboardConfig } from './types.js';
import { fetchOrCreateSession } from './sessionHelpers.js';
import { buildSectionModal } from './ModalFactory.js';
import { DASHBOARD_MESSAGES } from './messages.js';

/** Configuration for a generic dashboard select menu handler */
export interface GenericSelectMenuConfig<TFlat extends Record<string, unknown>, TRaw> {
  /** Entity type string used for custom ID routing (e.g., 'persona', 'preset') */
  entityType: string;
  /** Dashboard config defining the sections and modal fields */
  dashboardConfig: DashboardConfig<TFlat>;
  /** Fetch the raw entity data from the API */
  fetchFn: (entityId: string, user: GatewayUser) => Promise<TRaw | null>;
  /** Transform raw API data to the flattened session format */
  transformFn: (raw: TRaw) => TFlat;
  /** Entity name used in user-facing error messages (e.g., 'Persona', 'Preset') */
  entityName: string;
  /**
   * Optional permission check. Called after session data is fetched.
   * If it returns false, sends a "no permission" error and aborts.
   * Receives the flattened data, so it can inspect fields like `canEdit`.
   */
  canEdit?: (data: TFlat) => boolean;
}

/**
 * Handle a dashboard select menu interaction for the "edit section" flow.
 * Parses the custom ID, looks up the section, fetches the session, and
 * shows the section modal. Silently returns if the interaction doesn't
 * match the configured entity type.
 */
export async function handleDashboardSectionSelect<TFlat extends Record<string, unknown>, TRaw>(
  interaction: StringSelectMenuInteraction,
  config: GenericSelectMenuConfig<TFlat, TRaw>
): Promise<void> {
  const parsed = parseDashboardCustomId(interaction.customId);
  if (parsed?.entityType !== config.entityType || parsed.entityId === undefined) {
    return;
  }

  const value = interaction.values[0];
  const entityId = parsed.entityId;

  // Only handle 'edit-<sectionId>' values; caller's handler is responsible for other values
  if (!value.startsWith('edit-')) {
    return;
  }

  const sectionId = value.replace('edit-', '');
  const section = config.dashboardConfig.sections.find(s => s.id === sectionId);
  if (!section) {
    await interaction.reply({
      content: '❌ Unknown section.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Fetch or create the session
  const result = await fetchOrCreateSession<TFlat, TRaw>({
    userId: interaction.user.id,
    entityType: config.entityType,
    entityId,
    fetchFn: () => config.fetchFn(entityId, toGatewayUser(interaction.user)),
    transformFn: config.transformFn,
    interaction,
  });
  if (!result.success) {
    await interaction.reply({
      content: DASHBOARD_MESSAGES.NOT_FOUND(config.entityName),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Optional permission check
  if (config.canEdit && !config.canEdit(result.data)) {
    await interaction.reply({
      content: DASHBOARD_MESSAGES.NO_PERMISSION(`edit this ${config.entityName.toLowerCase()}`),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Build and show the section modal
  const modal = buildSectionModal<TFlat>(config.dashboardConfig, section, entityId, result.data);
  await interaction.showModal(modal);
}
