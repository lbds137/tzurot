/**
 * Dashboard Refresh Handler
 *
 * Shared utilities for refreshing dashboard data from the API.
 */

import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { getSessionManager } from './SessionManager.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  type ActionButtonOptions,
} from './DashboardBuilder.js';
import type { DashboardConfig } from './types.js';
import { DASHBOARD_MESSAGES } from './messages.js';

const logger = createLogger('dashboard-refresh');

/**
 * Options for creating a refresh handler
 */
export interface RefreshHandlerOptions<TData, TRaw = TData> {
  /** Entity type (e.g., 'persona', 'character', 'preset') */
  entityType: string;
  /** Dashboard configuration */
  dashboardConfig: DashboardConfig<TData>;
  /** Function to fetch fresh data */
  fetchFn: (entityId: string, userId: string) => Promise<TRaw | null>;
  /** Function to transform raw data to dashboard format (optional if same) */
  transformFn?: (raw: TRaw) => TData;
  /** Function to build action button options from data (optional) */
  buildOptions?: (data: TData) => ActionButtonOptions;
  /** Entity label for error messages */
  entityLabel?: string;
}

/**
 * Create a refresh handler for a specific entity type.
 *
 * @returns Handler function for refresh button
 *
 * @example
 * ```typescript
 * const handleRefresh = createRefreshHandler({
 *   entityType: 'persona',
 *   dashboardConfig: PERSONA_DASHBOARD_CONFIG,
 *   fetchFn: fetchPersona,
 *   transformFn: flattenPersonaData,
 *   buildOptions: buildPersonaDashboardOptions,
 * });
 *
 * // Later:
 * await handleRefresh(interaction, personaId);
 * ```
 */
export function createRefreshHandler<TData, TRaw = TData>(
  options: RefreshHandlerOptions<TData, TRaw>
): (interaction: ButtonInteraction, entityId: string) => Promise<void> {
  const {
    entityType,
    dashboardConfig,
    fetchFn,
    transformFn,
    buildOptions,
    entityLabel = entityType,
  } = options;

  return async (interaction: ButtonInteraction, entityId: string): Promise<void> => {
    await interaction.deferUpdate();

    const rawData = await fetchFn(entityId, interaction.user.id);

    if (rawData === null) {
      await interaction.editReply({
        content: DASHBOARD_MESSAGES.NOT_FOUND(entityLabel),
        embeds: [],
        components: [],
      });
      return;
    }

    // Transform if needed
    const data = transformFn !== undefined ? transformFn(rawData) : (rawData as unknown as TData);

    // Update session
    const sessionManager = getSessionManager();
    await sessionManager.set({
      userId: interaction.user.id,
      entityType,
      entityId,
      data,
      messageId: interaction.message.id,
      channelId: interaction.channelId,
    });

    // Build and update dashboard
    const embed = buildDashboardEmbed(dashboardConfig, data);
    const buttonOptions = buildOptions !== undefined ? buildOptions(data) : undefined;
    const components = buildDashboardComponents(dashboardConfig, entityId, data, buttonOptions);

    await interaction.editReply({ embeds: [embed], components });

    logger.debug({ entityType, entityId }, 'Dashboard refreshed');
  };
}

/**
 * Refresh dashboard UI after an update.
 * Used after modal submissions or action handlers.
 *
 * @example
 * ```typescript
 * await refreshDashboardUI({
 *   interaction,
 *   entityId,
 *   data: flattenedData,
 *   dashboardConfig: PRESET_DASHBOARD_CONFIG,
 *   buildOptions: buildPresetDashboardOptions,
 * });
 * ```
 */
export async function refreshDashboardUI<TData>(options: {
  interaction: ModalSubmitInteraction | ButtonInteraction;
  entityId: string;
  data: TData;
  dashboardConfig: DashboardConfig<TData>;
  buildOptions?: (data: TData) => ActionButtonOptions;
}): Promise<void> {
  const { interaction, entityId, data, dashboardConfig, buildOptions } = options;

  const embed = buildDashboardEmbed(dashboardConfig, data);
  const buttonOptions = buildOptions !== undefined ? buildOptions(data) : undefined;
  const components = buildDashboardComponents(dashboardConfig, entityId, data, buttonOptions);

  await interaction.editReply({ embeds: [embed], components });
}
