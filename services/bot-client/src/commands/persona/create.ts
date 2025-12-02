/**
 * Persona Create Handler
 *
 * Allows users to create new named personas via a Discord modal.
 * Each persona can have:
 * - Name (required) - identifier for the persona
 * - Preferred Name - what AI should call the user
 * - Pronouns
 * - Content/description - what AI should know about this persona
 */

import { MessageFlags, ModalBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, getPrismaClient } from '@tzurot/common-types';
import { buildPersonaModalFields } from './utils/modalBuilder.js';
import { personaCacheInvalidationService } from '../../redis.js';

const logger = createLogger('persona-create');

/**
 * Handle /persona create command - shows modal
 */
export async function handleCreatePersona(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const modal = new ModalBuilder().setCustomId('persona-create').setTitle('Create New Persona');

    const inputFields = buildPersonaModalFields(null, {
      namePlaceholder: 'e.g., Work Mode, Casual, Creative Writing',
      contentPlaceholder: 'Describe this persona: context, interests, how AI should interact...',
    });
    modal.addComponents(...inputFields);

    await interaction.showModal(modal);
    logger.info({ userId: interaction.user.id }, '[Persona] Showed create modal');
  } catch (error) {
    logger.error(
      { err: error, userId: interaction.user.id },
      '[Persona] Failed to show create modal'
    );
    await interaction.reply({
      content: '❌ Failed to open create dialog. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle modal submission for persona creation
 */
export async function handleCreateModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const prisma = getPrismaClient();
  const discordId = interaction.user.id;

  try {
    // Get values from modal
    const personaName = interaction.fields.getTextInputValue('personaName').trim();
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

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        id: true,
        defaultPersonaId: true,
      },
    });

    // Create user if they don't exist
    user ??= await prisma.user.create({
      data: {
        discordId,
        username: interaction.user.username,
      },
      select: {
        id: true,
        defaultPersonaId: true,
      },
    });

    // Create the new persona
    const newPersona = await prisma.persona.create({
      data: {
        name: personaName,
        preferredName,
        pronouns,
        content: content ?? '',
        ownerId: user.id,
      },
    });

    logger.info(
      { userId: discordId, personaId: newPersona.id, personaName },
      '[Persona] Created new persona'
    );

    // If this is the user's first persona and they don't have a default, set it
    const setAsDefault = user.defaultPersonaId === null;
    if (setAsDefault) {
      await prisma.user.update({
        where: { id: user.id },
        data: { defaultPersonaId: newPersona.id },
      });
      logger.info(
        { userId: discordId, personaId: newPersona.id },
        '[Persona] Set as default (first persona)'
      );
    }

    // Broadcast cache invalidation
    await personaCacheInvalidationService.invalidateUserPersona(discordId);

    // Build response
    const details: string[] = [];
    if (preferredName !== null) {
      details.push(`📛 Name: ${preferredName}`);
    }
    if (pronouns !== null) {
      details.push(`🏷️ Pronouns: ${pronouns}`);
    }
    if (content !== null) {
      details.push(`📝 Content: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
    }

    let response = `✅ **Persona "${personaName}" created!**`;
    if (details.length > 0) {
      response += `\n\n${details.join('\n')}`;
    }
    if (setAsDefault) {
      response += '\n\n⭐ This persona has been set as your default.';
    }
    response += '\n\nUse `/persona list` to see all your personas.';

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
