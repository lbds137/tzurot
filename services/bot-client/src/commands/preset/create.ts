/**
 * Preset Command - Create Handlers
 *
 * Handles preset creation flow:
 * 1. /preset create → Shows seed modal
 * 2. Modal submit → Creates preset via API
 * 3. Shows dashboard for further editing
 */

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ModalActionRowComponentBuilder,
  MessageFlags,
  type ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ModalCommandContext } from '../../utils/commandContext/types.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildDashboardCustomId,
  extractModalValues,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import {
  PRESET_DASHBOARD_CONFIG,
  flattenPresetData,
  presetSeedFields,
  buildPresetDashboardOptions,
} from './config.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createPreset } from './api.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { replySpec } from '../../ux/render/reply.js';

const logger = createLogger('preset-create');

/**
 * Show the seed modal for preset creation
 *
 * Receives ModalCommandContext (has showModal method!)
 * because this subcommand uses deferralMode: 'modal'.
 */
export async function handleCreate(context: ModalCommandContext): Promise<void> {
  // No slot option: a preset's vision-capability is derived from its model
  // (`supportsVision`), not chosen at creation. The vision SLOT is picked later
  // when the preset is assigned (set/set-default/global).
  const modal = new ModalBuilder()
    .setCustomId(buildDashboardCustomId('preset', 'seed'))
    .setTitle('Create New Preset');

  for (const field of presetSeedFields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setPlaceholder(field.placeholder ?? '')
      .setStyle(TextInputStyle.Short)
      .setRequired(field.required ?? false)
      .setMaxLength(field.maxLength);

    const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
    modal.addComponents(row);
  }

  await context.showModal(modal);
}

/**
 * Handle seed modal submission - create new preset
 */
export async function handleSeedModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const values = extractModalValues(
    interaction,
    presetSeedFields.map(f => f.id)
  );

  // Validate required fields
  if (!values.name || values.name.trim().length === 0) {
    await replySpec(interaction, CATALOG.error.validation('Preset name is required.'));
    return;
  }

  if (!values.model || values.model.trim().length === 0) {
    await replySpec(interaction, CATALOG.error.validation('Model ID is required.'));
    return;
  }

  try {
    // Create preset via API (API uses AI_DEFAULTS for sensible defaults)
    const { userClient } = clientsFor(interaction);
    const preset = await createPreset(
      {
        name: values.name.trim(),
        model: values.model.trim(),
        provider: 'openrouter', // Default provider
      },
      userClient
    );

    // Flatten the data for dashboard display
    const flattenedData = flattenPresetData(preset);

    // Build and send dashboard
    // Use buildPresetDashboardOptions for consistent button configuration (includes delete for owned presets)
    const embed = buildDashboardEmbed(PRESET_DASHBOARD_CONFIG, flattenedData);
    const components = buildDashboardComponents(
      PRESET_DASHBOARD_CONFIG,
      preset.id,
      flattenedData,
      buildPresetDashboardOptions(flattenedData)
    );

    const reply = await interaction.editReply({ embeds: [embed], components });

    // Create session
    const sessionManager = getSessionManager();
    await sessionManager.set({
      userId: interaction.user.id,
      entityType: 'preset',
      entityId: preset.id,
      data: flattenedData,
      messageId: reply.id,
      channelId: interaction.channelId ?? '',
    });

    logger.info(
      { userId: interaction.user.id, presetId: preset.id, name: preset.name },
      'Preset created via seed modal'
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to create preset');

    // Check for duplicate name error (match structured format to avoid false positives)
    if (error instanceof Error && error.message.includes(': 409 ')) {
      await replySpec(
        interaction,
        CATALOG.error.validation(
          `A preset with name "${values.name}" already exists.\nPlease choose a different name.`
        )
      );
      return;
    }

    await replySpec(
      interaction,
      classifyGatewayFailure(error, 'preset', { failedAction: 'create the preset' })
    );
  }
}
