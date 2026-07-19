/**
 * Character Command - Create Handlers
 *
 * Handles character creation flow:
 * 1. /character create → Shows seed modal
 * 2. Modal submit → Creates character via API
 * 3. Shows dashboard for further editing
 */

import { MessageFlags, type ModalSubmitInteraction } from 'discord.js';
import { type EnvConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { normalizeSlugForUser, suggestSlugExample } from '@tzurot/common-types/utils/slugUtils';
import {
  SLUG_PATTERN,
  SLUG_REQUIREMENTS_MESSAGE,
  SLUG_MIN_LENGTH,
} from '@tzurot/common-types/schemas/api/personality';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import type { ModalCommandContext } from '../../utils/commandContext/types.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildDashboardCustomId,
  extractModalValues,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import {
  getCharacterDashboardConfig,
  characterSeedFields,
  buildCharacterDashboardOptions,
} from './config.js';
import { buildToolkitModal, textFieldFromDefinition } from '../../utils/modal/toolkit.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { createCharacter, sendShadowedAliasFollowUp } from './api.js';

const logger = createLogger('character-create');

/**
 * Show the seed modal for character creation
 *
 * Receives ModalCommandContext (has showModal method!)
 * because this subcommand uses deferralMode: 'modal'.
 */
export async function handleCreate(context: ModalCommandContext): Promise<void> {
  const modal = buildToolkitModal({
    customId: buildDashboardCustomId('character', 'seed'),
    title: 'Create New Character',
    items: characterSeedFields.map(textFieldFromDefinition),
  });

  await context.showModal(modal);
}

/**
 * Handle seed modal submission - create new character
 */
export async function handleSeedModalSubmit(
  interaction: ModalSubmitInteraction,
  config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const values = extractModalValues(
    interaction,
    characterSeedFields.map(f => f.id)
  );

  // Validate slug format (before normalization) — same pattern the gateway
  // enforces, so a digit-leading slug fails here with a friendly message
  // instead of a raw 400 after submit.
  if (!SLUG_PATTERN.test(values.slug)) {
    await interaction.editReply(
      renderSpec(
        CATALOG.error.validation(
          `Invalid slug format. ${SLUG_REQUIREMENTS_MESSAGE}\nExample: \`${suggestSlugExample(values.name)}\``
        )
      )
    );
    return;
  }
  if (values.slug.length < SLUG_MIN_LENGTH || values.slug.length > DISCORD_LIMITS.SLUG_MAX_LENGTH) {
    await interaction.editReply(
      renderSpec(
        CATALOG.error.validation(
          `Slug must be ${SLUG_MIN_LENGTH}–${DISCORD_LIMITS.SLUG_MAX_LENGTH} characters (yours is ${values.slug.length}).`
        )
      )
    );
    return;
  }

  // Normalize slug: append username for non-bot-owners
  const normalizedSlug = normalizeSlugForUser(
    values.slug,
    interaction.user.id,
    interaction.user.username
  );

  try {
    const { userClient } = clientsFor(interaction);
    // Create character via API
    const { character, shadowedAliases } = await createCharacter(
      {
        name: values.name,
        slug: normalizedSlug,
        characterInfo: values.characterInfo,
        personalityTraits: values.personalityTraits,
        isPublic: false, // Default to private
      },
      userClient,
      config
    );

    // Build and send dashboard
    // Use slug as entityId (not UUID) because fetchCharacter expects slug
    // User just created this character, so they own it (canEdit: true from API)
    // New characters never have a voice reference yet (hasVoiceReference: false)
    const isAdmin = isBotOwner(interaction.user.id);
    const dashboardConfig = getCharacterDashboardConfig(isAdmin, character.hasVoiceReference);
    const embed = buildDashboardEmbed(dashboardConfig, character);
    const components = buildDashboardComponents(
      dashboardConfig,
      character.slug,
      character,
      buildCharacterDashboardOptions(character)
    );

    const reply = await interaction.editReply({ embeds: [embed], components });

    // Reverse-shadow advisory (warn-don't-block): the create succeeded, but
    // the chosen name/slug kills existing global aliases at resolution time.
    await sendShadowedAliasFollowUp(interaction, shadowedAliases);

    // Create session (keyed by slug)
    const sessionManager = getSessionManager();
    await sessionManager.set({
      userId: interaction.user.id,
      entityType: 'character',
      entityId: character.slug,
      data: character,
      messageId: reply.id,
      channelId: interaction.channelId ?? '',
    });

    logger.info(
      { userId: interaction.user.id, slug: character.slug },
      'Character created via seed modal'
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to create character');

    // Check for duplicate slug error
    if (error instanceof Error && error.message.includes('409')) {
      await interaction.editReply(
        renderSpec(
          CATALOG.error.validation(
            `A character with slug \`${normalizedSlug}\` already exists.\nPlease choose a different slug.`
          )
        )
      );
      return;
    }

    await interaction.editReply(
      renderSpec(
        classifyGatewayFailure(error, 'character', { failedAction: 'create the character' })
      )
    );
  }
}
