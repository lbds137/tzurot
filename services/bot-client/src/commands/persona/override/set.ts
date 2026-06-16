/**
 * Persona Override Set Handler
 *
 * Allows users to set different personas for specific characters.
 * This enables per-character customization while keeping a default persona.
 *
 * Flow:
 * - /persona override set <personality> <persona> - Set existing persona or create new
 * - If user selects "Create new persona..." option, shows a modal
 * - Otherwise, directly assigns the selected persona
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { MessageFlags, ModalBuilder, type ModalSubmitInteraction } from 'discord.js';
import {
  createLogger,
  DISCORD_LIMITS,
  truncateText,
  personaOverrideSetOptions,
  API_ERROR_SUBCODE,
} from '@tzurot/common-types';
import type { ModalCommandContext } from '../../../utils/commandContext/types.js';
import { CREATE_NEW_PERSONA_VALUE } from '../autocomplete.js';
import { buildPersonaModalFields } from '../utils/modalBuilder.js';
import { PersonaCustomIds } from '../../../utils/customIds.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { clientsFor } from '../../../utils/gatewayClients.js';

const logger = createLogger('persona-override-set');

/** Map API error to user-friendly message, or null if no specific mapping */
function mapOverrideError(error: string | undefined, personalitySlug: string): string | null {
  if (error === undefined) {
    return null;
  }
  // Check specific errors first before generic 'not found'
  if (error.includes('Persona not found')) {
    return '❌ Persona not found. Use `/persona browse` to see your personas.';
  }
  if (error.includes('Personality not found') || error.includes('personality not found')) {
    return `❌ Character "${personalitySlug}" not found.`;
  }
  if (error.includes('no account') || error.includes('User not found')) {
    return "❌ You don't have an account yet. Send a message to any character to create one!";
  }
  return null;
}

/** Show modal to create a new persona for override */
async function showCreateOverrideModal(
  context: ModalCommandContext,
  discordId: string,
  personalitySlug: string
): Promise<void> {
  const { userClient } = clientsFor(context.interaction);
  const infoResult = await userClient.getPersonaOverride(personalitySlug);

  if (!infoResult.ok) {
    const errorMsg = mapOverrideError(infoResult.error, personalitySlug);
    await context.reply({
      content: errorMsg ?? '❌ Failed to prepare persona creation. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { personality } = infoResult.data;
  const personalityName = personality.displayName ?? personality.name;

  const modal = new ModalBuilder()
    .setCustomId(PersonaCustomIds.overrideCreate(personality.id))
    .setTitle(
      `New Persona for ${truncateText(personalityName, DISCORD_LIMITS.MODAL_TITLE_DYNAMIC_CONTENT)}`
    );

  const inputFields = buildPersonaModalFields(null, {
    namePlaceholder: `e.g., "My ${personalityName} Persona"`,
    preferredNameLabel: `Preferred Name (what ${personalityName} calls you)`,
    preferredNamePlaceholder: `What should ${personalityName} call you?`,
    contentLabel: `About You (for ${personalityName})`,
    contentPlaceholder: `Tell ${personalityName} specific things about yourself...`,
  });
  modal.addComponents(...inputFields);

  await context.showModal(modal);
  logger.info(
    { userId: discordId, personalityId: personality.id },
    'Showed create-for-override modal'
  );
}

/** Set an existing persona as override for a character */
async function setExistingOverride(
  context: ModalCommandContext,
  discordId: string,
  personalitySlug: string,
  personaId: string
): Promise<void> {
  const { userClient } = clientsFor(context.interaction);
  const result = await userClient.setPersonaOverride(personalitySlug, { personaId });

  if (!result.ok) {
    const errorMsg = mapOverrideError(result.error, personalitySlug);
    if (errorMsg !== null) {
      await context.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
      return;
    }
    logger.warn(
      { userId: discordId, personalitySlug, personaId, error: result.error },
      'Failed to set override'
    );
    await context.reply({
      content: '❌ Failed to set persona override. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { personality, persona } = result.data;
  const personalityName = personality.displayName ?? personality.name;
  const displayName = persona.preferredName ?? persona.name;

  logger.info(
    { userId: discordId, personalityId: personality.id, personaId: persona.id },
    'Set override persona'
  );

  await context.reply({
    content: `✅ **Persona override set for ${personalityName}!**\n\n📋 Using: **${displayName}**\n\nThis persona will be used when talking to ${personalityName} instead of your default persona.`,
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Handle /persona override set <personality> <persona> command
 */
export async function handleOverrideSet(context: ModalCommandContext): Promise<void> {
  const discordId = context.user.id;
  const options = personaOverrideSetOptions(context.interaction);
  const personalitySlug = options.character();
  const personaId = options.persona();

  if (isAutocompleteErrorSentinel(personalitySlug) || isAutocompleteErrorSentinel(personaId)) {
    await context.reply({
      content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    if (personaId === CREATE_NEW_PERSONA_VALUE) {
      await showCreateOverrideModal(context, discordId, personalitySlug);
    } else {
      await setExistingOverride(context, discordId, personalitySlug, personaId);
    }
  } catch (error) {
    logger.error({ err: error, userId: discordId }, 'Failed to set override');
    await context.reply({
      content: '❌ Failed to set persona override. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle modal submission for creating a new persona during override
 * Modal customId format: persona::override-create::{personalityId}
 */
export async function handleOverrideCreateModalSubmit(
  interaction: ModalSubmitInteraction,
  personalityId: string
): Promise<void> {
  const discordId = interaction.user.id;

  try {
    // Get values from modal
    const personaName = interaction.fields.getTextInputValue('personaName').trim();
    const description = interaction.fields.getTextInputValue('description').trim() || null;
    const preferredName = interaction.fields.getTextInputValue('preferredName').trim() || null;
    const pronouns = interaction.fields.getTextInputValue('pronouns').trim() || null;
    // Modal sets `.setRequired(true)` on content, so Discord guarantees a
    // non-empty value here. Whitespace-only edge cases fall through to the
    // gateway's PersonaCreateSchema.content.min(1) validator.
    const content = interaction.fields.getTextInputValue('content').trim();

    // Persona name is required
    if (personaName.length === 0) {
      await interaction.reply({
        content: '❌ Persona name is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { userClient } = clientsFor(interaction);
    const result = await userClient.createPersonaOverride(personalityId, {
      name: personaName,
      description,
      preferredName,
      pronouns,
      content,
    });

    if (!result.ok) {
      if (result.code === API_ERROR_SUBCODE.NAME_COLLISION) {
        await interaction.reply({
          content: `❌ You already have a persona named "${personaName}". Pick a different name, or edit the existing one with \`/persona edit\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (result.error.includes('User not found')) {
        await interaction.reply({
          content: '❌ User not found.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      logger.warn(
        { userId: discordId, personalityId, error: result.error },
        'Failed to create override persona via gateway'
      );
      await interaction.reply({
        content: '❌ Failed to create persona. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { persona, personality } = result.data;
    const personalityName = personality.displayName ?? personality.name;

    logger.info(
      { userId: discordId, personalityId, personaId: persona.id, personaName },
      'Created new persona and set as override'
    );

    await interaction.reply({
      content:
        `✅ **Persona "${personaName}" created and set as override for ${personalityName}!**\n\n` +
        `This persona will be used when talking to ${personalityName}.\n\n` +
        `Use \`/persona browse\` to see all your personas.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logger.error(
      { err: error, userId: discordId, personalityId },
      'Failed to create override persona'
    );
    await interaction.reply({
      content: '❌ Failed to create persona. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
