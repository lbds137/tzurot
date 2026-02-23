/**
 * Persona Override Set Handler
 *
 * Allows users to set different personas for specific personalities.
 * This enables per-personality customization while keeping a default persona.
 *
 * Flow:
 * - /persona override set <personality> <persona> - Set existing persona or create new
 * - If user selects "Create new persona..." option, shows a modal
 * - Otherwise, directly assigns the selected persona
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { MessageFlags, ModalBuilder } from 'discord.js';
import type { ModalSubmitInteraction } from 'discord.js';
import {
  createLogger,
  DISCORD_LIMITS,
  truncateText,
  personaOverrideSetOptions,
} from '@tzurot/common-types';
import type { ModalCommandContext } from '../../../utils/commandContext/types.js';
import { CREATE_NEW_PERSONA_VALUE } from '../autocomplete.js';
import { buildPersonaModalFields } from '../utils/modalBuilder.js';
import { PersonaCustomIds } from '../../../utils/customIds.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';

const logger = createLogger('persona-override-set');

/** Response type for setting override */
interface SetOverrideResponse {
  success: boolean;
  personality: {
    id: string;
    name: string;
    displayName: string | null;
  };
  persona: {
    id: string;
    name: string;
    preferredName: string | null;
  };
}

/** Response type for getting override info (for modal) */
interface OverrideInfoResponse {
  personality: {
    id: string;
    name: string;
    displayName: string | null;
  };
}

/** Response type for creating persona and setting as override */
interface CreateOverrideResponse {
  success: boolean;
  persona: {
    id: string;
    name: string;
    preferredName: string | null;
    description: string | null;
    pronouns: string | null;
    content: string | null;
  };
  personality: {
    name: string;
    displayName: string | null;
  };
}

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
    return `❌ Personality "${personalitySlug}" not found.`;
  }
  if (error.includes('no account') || error.includes('User not found')) {
    return "❌ You don't have an account yet. Send a message to any personality to create one!";
  }
  return null;
}

/** Show modal to create a new persona for override */
async function showCreateOverrideModal(
  context: ModalCommandContext,
  discordId: string,
  personalitySlug: string
): Promise<void> {
  const infoResult = await callGatewayApi<OverrideInfoResponse>(
    `/user/persona/override/${personalitySlug}`,
    { userId: discordId }
  );

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
    '[Persona] Showed create-for-override modal'
  );
}

/** Set an existing persona as override for a personality */
async function setExistingOverride(
  context: ModalCommandContext,
  discordId: string,
  personalitySlug: string,
  personaId: string
): Promise<void> {
  const result = await callGatewayApi<SetOverrideResponse>(
    `/user/persona/override/${personalitySlug}`,
    { userId: discordId, method: 'PUT', body: { personaId } }
  );

  if (!result.ok) {
    const errorMsg = mapOverrideError(result.error, personalitySlug);
    if (errorMsg !== null) {
      await context.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
      return;
    }
    logger.warn(
      { userId: discordId, personalitySlug, personaId, error: result.error },
      '[Persona] Failed to set override'
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
    '[Persona] Set override persona'
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
  const personalitySlug = options.personality();
  const personaId = options.persona();

  try {
    if (personaId === CREATE_NEW_PERSONA_VALUE) {
      await showCreateOverrideModal(context, discordId, personalitySlug);
    } else {
      await setExistingOverride(context, discordId, personalitySlug, personaId);
    }
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Persona] Failed to set override');
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
    const content = interaction.fields.getTextInputValue('content').trim() || null;

    // Persona name is required
    if (personaName.length === 0) {
      await interaction.reply({
        content: '❌ Persona name is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Create persona and set as override via gateway (using personality ID in path)
    const result = await callGatewayApi<CreateOverrideResponse>(
      `/user/persona/override/by-id/${personalityId}`,
      {
        userId: discordId,
        method: 'POST',
        body: {
          name: personaName,
          description,
          preferredName,
          pronouns,
          content: content ?? '',
          username: interaction.user.username,
        },
      }
    );

    if (!result.ok) {
      if (result.error?.includes('User not found')) {
        await interaction.reply({
          content: '❌ User not found.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      logger.warn(
        { userId: discordId, personalityId, error: result.error },
        '[Persona] Failed to create override persona via gateway'
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
      '[Persona] Created new persona and set as override'
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
      '[Persona] Failed to create override persona'
    );
    await interaction.reply({
      content: '❌ Failed to create persona. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
