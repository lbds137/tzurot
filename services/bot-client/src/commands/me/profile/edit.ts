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
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS } from '@tzurot/common-types';
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
 * Handle /me profile edit [profile] command - shows modal
 *
 * @param interaction - The command interaction
 * @param personaId - Optional profile ID from autocomplete. If null, edit default profile.
 */
export async function handleEditPersona(
  interaction: ChatInputCommandInteraction,
  personaId?: string | null
): Promise<void> {
  const discordId = interaction.user.id;

  try {
    let persona: PersonaDetails | null = null;

    if (personaId !== null && personaId !== undefined) {
      // Fetch specific persona via gateway
      const result = await callGatewayApi<PersonaDetails>(`/user/persona/${personaId}`, {
        userId: discordId,
      });

      if (!result.ok) {
        await interaction.reply({
          content: '❌ Profile not found. Use `/me profile list` to see your profiles.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      persona = result.data;
    } else {
      // Find default persona from list
      const listResult = await callGatewayApi<{ personas: PersonaSummary[] }>('/user/persona', {
        userId: discordId,
      });

      if (listResult.ok) {
        const defaultPersona = listResult.data.personas.find(p => p.isDefault);
        if (defaultPersona !== undefined) {
          // Fetch full details of default persona
          const detailsResult = await callGatewayApi<PersonaDetails>(
            `/user/persona/${defaultPersona.id}`,
            { userId: discordId }
          );
          if (detailsResult.ok) {
            persona = detailsResult.data;
          }
        }
      }
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

    await interaction.showModal(modal);
    logger.info(
      { userId: discordId, personaId: persona?.id ?? 'new' },
      '[Me/Profile] Showed edit modal'
    );
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me/Profile] Failed to show edit modal');
    await interaction.reply({
      content: '❌ Failed to open edit dialog. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle modal submission for profile edit
 *
 * @param interaction - The modal submit interaction
 * @param personaId - Profile ID from modal customId, or 'new' for creating
 */
export async function handleEditModalSubmit(
  interaction: ModalSubmitInteraction,
  personaId: string
): Promise<void> {
  const discordId = interaction.user.id;

  try {
    // Get values from modal
    const personaName = interaction.fields.getTextInputValue('personaName').trim();
    const description = interaction.fields.getTextInputValue('description').trim() || null;
    const preferredName = interaction.fields.getTextInputValue('preferredName').trim() || null;
    const pronouns = interaction.fields.getTextInputValue('pronouns').trim() || null;
    const content = interaction.fields.getTextInputValue('content').trim() || null;

    // Profile name is required
    if (personaName.length === 0) {
      await interaction.reply({
        content: '❌ Profile name is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (personaId === 'new') {
      // Create new profile via gateway
      const result = await callGatewayApi<SavePersonaResponse>('/user/persona', {
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
      });

      if (!result.ok) {
        logger.warn(
          { userId: discordId, error: result.error },
          '[Me/Profile] Failed to create profile via gateway'
        );
        await interaction.reply({
          content: '❌ Failed to create your profile. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { persona, setAsDefault } = result.data;

      logger.info(
        { userId: discordId, personaId: persona.id, personaName },
        '[Me/Profile] Created new profile from edit'
      );

      let response = `✅ **Profile "${personaName}" created!**`;
      if (setAsDefault === true) {
        response += '\n\n⭐ This profile has been set as your default.';
      }
      await interaction.reply({
        content: response,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      // Update existing profile via gateway
      const result = await callGatewayApi<SavePersonaResponse>(`/user/persona/${personaId}`, {
        userId: discordId,
        method: 'PUT',
        body: {
          name: personaName,
          description,
          preferredName,
          pronouns,
          content: content ?? '',
        },
      });

      if (!result.ok) {
        // Handle specific error cases
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
          '[Me/Profile] Failed to update profile via gateway'
        );
        await interaction.reply({
          content: '❌ Failed to save your profile. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      logger.info(
        { userId: discordId, personaId, personaName },
        '[Me/Profile] Updated existing profile'
      );

      // Build response message
      const changes: string[] = [];
      changes.push(`📝 Name: ${personaName}`);
      if (description !== null) {
        changes.push(`📋 Description: ${description}`);
      }
      if (preferredName !== null) {
        changes.push(`📛 Preferred Name: ${preferredName}`);
      }
      if (pronouns !== null) {
        changes.push(`🏷️ Pronouns: ${pronouns}`);
      }
      if (content !== null) {
        changes.push(
          `📄 Content: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`
        );
      }

      const responseContent =
        changes.length > 0
          ? `✅ **Profile updated!**\n\n${changes.join('\n')}`
          : '✅ **Profile saved!** (All optional fields cleared)';

      await interaction.reply({
        content: responseContent,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me/Profile] Failed to save profile');
    await interaction.reply({
      content: '❌ Failed to save your profile. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
