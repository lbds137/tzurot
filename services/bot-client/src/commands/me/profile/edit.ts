/**
 * Me Edit Handler
 *
 * Allows users to edit their profile information via a Discord modal:
 * - Profile name (identifier for the profile)
 * - Preferred name (what AI calls the user)
 * - Pronouns
 * - Content/description (what AI should know about them)
 *
 * If no profile is specified, edits the user's default profile.
 * If user has no default profile, creates one.
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { MessageFlags, ModalBuilder } from 'discord.js';
import type { ModalSubmitInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS } from '@tzurot/common-types';
import type { ModalCommandContext } from '../../../utils/commandContext/types.js';
import { buildPersonaModalFields } from './utils/modalBuilder.js';
import { MeCustomIds } from '../../../utils/customIds.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';

const logger = createLogger('me-profile-edit');

/** Response type for persona list */
interface PersonaSummary {
  id: string;
  name: string;
  preferredName: string | null;
  isDefault: boolean;
}

/** Response type for persona details */
interface PersonaDetails {
  id: string;
  name: string;
  description: string | null;
  preferredName: string | null;
  pronouns: string | null;
  content: string | null;
}

/** Response type for creating/updating a persona */
interface SavePersonaResponse {
  success: boolean;
  persona: PersonaDetails;
  setAsDefault?: boolean;
}

/**
 * Fetch the user's default persona if one exists
 * @internal
 */
async function fetchDefaultPersona(discordId: string): Promise<PersonaDetails | null> {
  const listResult = await callGatewayApi<{ personas: PersonaSummary[] }>('/user/persona', {
    userId: discordId,
  });

  if (!listResult.ok) {
    return null;
  }

  const defaultPersona = listResult.data.personas.find(p => p.isDefault);
  if (defaultPersona === undefined) {
    return null;
  }

  // Fetch full details of default persona
  const detailsResult = await callGatewayApi<{ persona: PersonaDetails }>(
    `/user/persona/${defaultPersona.id}`,
    { userId: discordId }
  );

  return detailsResult.ok ? detailsResult.data.persona : null;
}

/**
 * Handle /me profile edit [profile] command - shows modal
 *
 * @param context - The modal command context
 * @param personaId - Optional profile ID from autocomplete. If null, edit default profile.
 */
export async function handleEditPersona(
  context: ModalCommandContext,
  personaId?: string | null
): Promise<void> {
  const discordId = context.user.id;

  try {
    let persona: PersonaDetails | null = null;

    if (personaId !== null && personaId !== undefined) {
      // Fetch specific persona via gateway
      const result = await callGatewayApi<{ persona: PersonaDetails }>(
        `/user/persona/${personaId}`,
        {
          userId: discordId,
        }
      );

      if (!result.ok) {
        await context.reply({
          content: '❌ Profile not found. Use `/me profile list` to see your profiles.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      persona = result.data.persona;
    } else {
      // Find and fetch default persona
      persona = await fetchDefaultPersona(discordId);
    }

    // Build the modal
    // Store profile ID in customId if editing existing, or 'new' if creating
    const modalCustomId =
      persona !== null ? MeCustomIds.profile.edit(persona.id) : MeCustomIds.profile.editNew();

    const modalTitle =
      persona !== null
        ? `Edit: ${persona.name.substring(0, DISCORD_LIMITS.MODAL_TITLE_DYNAMIC_CONTENT)}`
        : 'Create Your Profile';

    const modal = new ModalBuilder().setCustomId(modalCustomId).setTitle(modalTitle);

    const inputFields = buildPersonaModalFields(persona);
    modal.addComponents(...inputFields);

    await context.showModal(modal);
    logger.info(
      { userId: discordId, personaId: persona?.id ?? 'new' },
      '[Me/Profile] Showed edit modal'
    );
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me/Profile] Failed to show edit modal');
    await context.reply({
      content: '❌ Failed to open edit dialog. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/** Values extracted from modal submission */
interface ModalValues {
  personaName: string;
  description: string | null;
  preferredName: string | null;
  pronouns: string | null;
  content: string | null;
}

/** Extract and validate modal field values */
function extractModalValues(interaction: ModalSubmitInteraction): ModalValues | null {
  const personaName = interaction.fields.getTextInputValue('personaName').trim();
  if (personaName.length === 0) {
    return null;
  }
  return {
    personaName,
    description: interaction.fields.getTextInputValue('description').trim() || null,
    preferredName: interaction.fields.getTextInputValue('preferredName').trim() || null,
    pronouns: interaction.fields.getTextInputValue('pronouns').trim() || null,
    content: interaction.fields.getTextInputValue('content').trim() || null,
  };
}

/** Create a new profile */
async function createNewProfile(
  interaction: ModalSubmitInteraction,
  values: ModalValues
): Promise<void> {
  const discordId = interaction.user.id;

  const result = await callGatewayApi<SavePersonaResponse>('/user/persona', {
    userId: discordId,
    method: 'POST',
    body: {
      name: values.personaName,
      description: values.description,
      preferredName: values.preferredName,
      pronouns: values.pronouns,
      content: values.content ?? '',
      username: interaction.user.username,
    },
  });

  if (!result.ok) {
    logger.warn(
      { userId: discordId, error: result.error },
      '[Me/Profile] Failed to create profile'
    );
    await interaction.reply({
      content: '❌ Failed to create your profile. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { persona, setAsDefault } = result.data;
  logger.info({ userId: discordId, personaId: persona.id }, '[Me/Profile] Created new profile');

  let response = `✅ **Profile "${values.personaName}" created!**`;
  if (setAsDefault === true) {
    response += '\n\n⭐ This profile has been set as your default.';
  }
  await interaction.reply({ content: response, flags: MessageFlags.Ephemeral });
}

/** Update an existing profile */
async function updateExistingProfile(
  interaction: ModalSubmitInteraction,
  personaId: string,
  values: ModalValues
): Promise<void> {
  const discordId = interaction.user.id;

  const result = await callGatewayApi<SavePersonaResponse>(`/user/persona/${personaId}`, {
    userId: discordId,
    method: 'PUT',
    body: {
      name: values.personaName,
      description: values.description,
      preferredName: values.preferredName,
      pronouns: values.pronouns,
      content: values.content ?? '',
    },
  });

  if (!result.ok) {
    if (result.error?.includes('not found') || result.error?.includes('Not found')) {
      await interaction.reply({
        content:
          '❌ Profile not found or you do not own it. Use `/me profile list` to see your profiles.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    logger.warn(
      { userId: discordId, personaId, error: result.error },
      '[Me/Profile] Failed to update profile'
    );
    await interaction.reply({
      content: '❌ Failed to save your profile. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  logger.info({ userId: discordId, personaId }, '[Me/Profile] Updated profile');

  const changes = [`📝 Name: ${values.personaName}`];
  if (values.description !== null) {
    changes.push(`📋 Description: ${values.description}`);
  }
  if (values.preferredName !== null) {
    changes.push(`📛 Preferred Name: ${values.preferredName}`);
  }
  if (values.pronouns !== null) {
    changes.push(`🏷️ Pronouns: ${values.pronouns}`);
  }
  if (values.content !== null) {
    changes.push(
      `📄 Content: ${values.content.substring(0, 100)}${values.content.length > 100 ? '...' : ''}`
    );
  }

  const responseContent = `✅ **Profile updated!**\n\n${changes.join('\n')}`;
  await interaction.reply({ content: responseContent, flags: MessageFlags.Ephemeral });
}

/**
 * Handle modal submission for profile edit
 */
export async function handleEditModalSubmit(
  interaction: ModalSubmitInteraction,
  personaId: string
): Promise<void> {
  const discordId = interaction.user.id;

  try {
    const values = extractModalValues(interaction);
    if (values === null) {
      await interaction.reply({
        content: '❌ Profile name is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (personaId === 'new') {
      await createNewProfile(interaction, values);
    } else {
      await updateExistingProfile(interaction, personaId, values);
    }
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me/Profile] Failed to save profile');
    await interaction.reply({
      content: '❌ Failed to save your profile. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
