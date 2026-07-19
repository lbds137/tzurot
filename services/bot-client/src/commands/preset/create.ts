/**
 * Preset Command - Create Handlers
 *
 * Handles preset creation flow:
 * 1. /preset create → Shows seed modal
 * 2. Modal submit → Creates preset via API
 * 3. Shows dashboard for further editing
 */

import { MessageFlags, type ModalBuilder, type ModalSubmitInteraction } from 'discord.js';
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
import { buildToolkitModal, textFieldFromDefinition } from '../../utils/modal/toolkit.js';
import { replyWithModalRetry } from '../../utils/modal/retry.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createPreset } from './api.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

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
  await context.showModal(buildPresetSeedModal());
}

/** Seed modal builder — shared by create and the retry affordance. */
export function buildPresetSeedModal(initialValues?: Record<string, string>): ModalBuilder {
  return buildToolkitModal({
    customId: buildDashboardCustomId('preset', 'seed'),
    title: 'Create New Preset',
    items: presetSeedFields.map(textFieldFromDefinition),
    initialValues,
  });
}

/** Validation-failure reply + prefill stash (shared D15 helper). */
async function replyWithRetry(
  interaction: ModalSubmitInteraction,
  content: string,
  values: Record<string, string>
): Promise<void> {
  await replyWithModalRetry(interaction, {
    commandPrefix: 'preset',
    kind: 'seed',
    content,
    values,
  });
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
    await replyWithRetry(
      interaction,
      renderSpec(CATALOG.error.validation('Preset name is required.')),
      values
    );
    return;
  }

  if (!values.model || values.model.trim().length === 0) {
    await replyWithRetry(
      interaction,
      renderSpec(CATALOG.error.validation('Model ID is required.')),
      values
    );
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
      await replyWithRetry(
        interaction,
        renderSpec(
          CATALOG.error.validation(
            `A preset with name "${values.name}" already exists.\nPlease choose a different name.`
          )
        ),
        values
      );
      return;
    }

    // Transient failures also lose typed input through no fault of the
    // user's — carry the retry affordance. A resubmit either succeeds or
    // lands on the 409 path above, so a blind retry is write-safe.
    await replyWithRetry(
      interaction,
      renderSpec(classifyGatewayFailure(error, 'preset', { failedAction: 'create the preset' })),
      values
    );
  }
}
