/**
 * Persona Create Handler
 *
 * Allows users to create new named personas via a Discord modal.
 * Each persona can have:
 * - Name (required) - identifier for the persona
 * - Preferred Name - what AI should call the user
 * - Pronouns
 * - Content/description - what AI should know about this persona
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { MessageFlags, ModalBuilder } from 'discord.js';
import type { ModalSubmitInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { ModalCommandContext } from '../../utils/commandContext/types.js';
import { buildPersonaModalFields } from './utils/modalBuilder.js';
import { PersonaCustomIds } from '../../utils/customIds.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('persona-create');

/** Response type for creating a persona */
interface CreatePersonaResponse {
  success: boolean;
  persona: {
    id: string;
    name: string;
    preferredName: string | null;
    description: string | null;
    pronouns: string | null;
    content: string | null;
  };
  setAsDefault: boolean;
}

/**
 * Handle /persona create command - shows modal
 */
export async function handleCreatePersona(context: ModalCommandContext): Promise<void> {
  try {
    const modal = new ModalBuilder()
      .setCustomId(PersonaCustomIds.create())
      .setTitle('Create New Persona');

    const inputFields = buildPersonaModalFields(null, {
      namePlaceholder: 'e.g., Work Mode, Casual, Creative Writing',
      contentPlaceholder: 'Describe this persona: context, interests, how AI should interact...',
    });
    modal.addComponents(...inputFields);

    await context.showModal(modal);
    logger.info({ userId: context.user.id }, '[Persona] Showed create modal');
  } catch (error) {
    logger.error({ err: error, userId: context.user.id }, '[Persona] Failed to show create modal');
    await context.reply({
      content: '❌ Failed to open create dialog. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle modal submission for persona creation
 */
export async function handleCreateModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
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

    // Create persona via gateway API
    const result = await callGatewayApi<CreatePersonaResponse>('/user/persona', {
      userId: discordId,
      method: 'POST',
      body: {
        name: personaName,
        description,
        preferredName,
        pronouns,
        content: content ?? '',
        // Pass username for user creation if needed
        username: interaction.user.username,
      },
    });

    if (!result.ok) {
      logger.warn(
        { userId: discordId, error: result.error },
        '[Persona] Failed to create persona via gateway'
      );
      await interaction.reply({
        content: '❌ Failed to create persona. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { persona, setAsDefault } = result.data;

    logger.info(
      { userId: discordId, personaId: persona.id, personaName },
      '[Persona] Created new persona'
    );

    if (setAsDefault) {
      logger.info(
        { userId: discordId, personaId: persona.id },
        '[Persona] Set as default (first persona)'
      );
    }

    // Build response
    const details: string[] = [];
    if (persona.description !== null) {
      details.push(`📋 Description: ${persona.description}`);
    }
    if (persona.preferredName !== null) {
      details.push(`📛 Name: ${persona.preferredName}`);
    }
    if (persona.pronouns !== null) {
      details.push(`🏷️ Pronouns: ${persona.pronouns}`);
    }
    if (persona.content !== null && persona.content.length > 0) {
      details.push(
        `📝 Content: ${persona.content.substring(0, 100)}${persona.content.length > 100 ? '...' : ''}`
      );
    }

    let response = `✅ **Persona "${personaName}" created!**`;
    if (details.length > 0) {
      response += `\n\n${details.join('\n')}`;
    }
    if (setAsDefault) {
      response += '\n\n⭐ This persona has been set as your default.';
    }
    response += '\n\nUse `/persona browse` to see all your personas.';

    await interaction.reply({
      content: response,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Persona] Failed to create persona');
    await interaction.reply({
      content: '❌ Failed to create persona. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
