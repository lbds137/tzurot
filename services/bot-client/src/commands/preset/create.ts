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
import {
  createLogger,
  presetCreateOptions,
  toConfigKind,
  DEFAULT_CONFIG_KIND,
} from '@tzurot/common-types';
import type { ModalCommandContext } from '../../utils/commandContext/types.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildDashboardCustomId,
  parseDashboardCustomId,
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
import { extractApiErrorMessage } from '../../utils/dashboard/saveError.js';
import { replyError } from '../../utils/dashboard/replyError.js';

const logger = createLogger('preset-create');

/**
 * Show the seed modal for preset creation
 *
 * Receives ModalCommandContext (has showModal method!)
 * because this subcommand uses deferralMode: 'modal'.
 */
export async function handleCreate(context: ModalCommandContext): Promise<void> {
  // The kind (text|vision, default text) is chosen via the command option and
  // carried through the modal in the custom-ID's 3rd segment (preset::seed::<kind>),
  // since modals can't hold a select. handleSeedModalSubmit reads it back.
  // Uses the generated typed accessor (matches the other preset setters).
  const kind = toConfigKind(presetCreateOptions(context.interaction).kind() ?? DEFAULT_CONFIG_KIND);
  const isVision = kind === 'vision';

  const modal = new ModalBuilder()
    .setCustomId(buildDashboardCustomId('preset', 'seed', kind))
    .setTitle(isVision ? 'Create New Vision Preset' : 'Create New Preset');

  for (const field of presetSeedFields) {
    // Clarify the model field for vision presets (its value must be a
    // vision-capable model; the save-time capability gate enforces it).
    const label = isVision && field.id === 'model' ? 'Vision model' : field.label;
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(label)
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

  // Recover the kind chosen at /preset create from the modal custom-ID
  // (preset::seed::<kind>). parseDashboardCustomId surfaces the 3rd segment as
  // `entityId` — here it carries the kind, not an entity ID. Narrow to the
  // ConfigKind union; legacy IDs without a 3rd segment fall through to text.
  const kind =
    parseDashboardCustomId(interaction.customId)?.entityId === 'vision' ? 'vision' : 'text';

  // Validate required fields
  if (!values.name || values.name.trim().length === 0) {
    await replyError(interaction, '❌ Preset name is required.');
    return;
  }

  if (!values.model || values.model.trim().length === 0) {
    await replyError(interaction, '❌ Model ID is required.');
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
        kind,
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
      await replyError(
        interaction,
        `❌ A preset with name "${values.name}" already exists.\n` +
          'Please choose a different name.'
      );
      return;
    }

    await replyError(
      interaction,
      `❌ ${extractApiErrorMessage(error) ?? 'Failed to create preset. Please try again.'}`
    );
  }
}
