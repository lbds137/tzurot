/**
 * Persona Edit Handler
 *
 * Allows users to edit their persona information via a Discord modal:
 * - Preferred name
 * - Pronouns
 * - Content/description (what AI should know about them)
 */

import { MessageFlags, ModalBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, getPrismaClient } from '@tzurot/common-types';
import { buildPersonaInputFields } from './utils/modalBuilder.js';
import { personaCacheInvalidationService } from '../../redis.js';

const logger = createLogger('persona-edit');

/**
 * Handle /persona edit command - shows modal
 */
export async function handleEditPersona(interaction: ChatInputCommandInteraction): Promise<void> {
  const prisma = getPrismaClient();
  const discordId = interaction.user.id;

  try {
    // Get current persona values to pre-fill the modal
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        defaultPersona: {
          select: {
            preferredName: true,
            pronouns: true,
            content: true,
          },
        },
      },
    });

    const persona = user?.defaultPersona;

    // Build the modal with shared input fields
    const modal = new ModalBuilder().setCustomId('persona-edit').setTitle('Edit Your Persona');

    const inputFields = buildPersonaInputFields(persona);
    modal.addComponents(...inputFields);

    await interaction.showModal(modal);
    logger.info({ userId: discordId }, '[Persona] Showed edit modal');
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Persona] Failed to show edit modal');
    await interaction.reply({
      content: '❌ Failed to open edit dialog. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle modal submission for persona edit
 */
export async function handleEditModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const prisma = getPrismaClient();
  const discordId = interaction.user.id;

  try {
    // Get values from modal
    const preferredName = interaction.fields.getTextInputValue('preferredName').trim() || null;
    const pronouns = interaction.fields.getTextInputValue('pronouns').trim() || null;
    const content = interaction.fields.getTextInputValue('content').trim() || null;

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

    const existingPersonaId = user.defaultPersonaId;

    if (existingPersonaId !== null && existingPersonaId !== undefined) {
      // Update existing persona
      await prisma.persona.update({
        where: { id: existingPersonaId },
        data: {
          preferredName,
          pronouns,
          content: content ?? '',
          updatedAt: new Date(),
        },
      });

      logger.info(
        { userId: discordId, personaId: existingPersonaId },
        '[Persona] Updated existing persona'
      );

      // Broadcast cache invalidation to all ai-worker instances
      await personaCacheInvalidationService.invalidateUserPersona(discordId);
    } else {
      // Create new persona and set it as default
      const newPersona = await prisma.persona.create({
        data: {
          name: `${interaction.user.username}'s Persona`,
          preferredName,
          pronouns,
          content: content ?? '',
          ownerId: user.id,
        },
      });

      // Set as user's default persona
      await prisma.user.update({
        where: { id: user.id },
        data: { defaultPersonaId: newPersona.id },
      });

      logger.info(
        { userId: discordId, personaId: newPersona.id },
        '[Persona] Created new persona and set as default'
      );

      // Broadcast cache invalidation to all ai-worker instances
      await personaCacheInvalidationService.invalidateUserPersona(discordId);
    }

    // Build response message
    const changes: string[] = [];
    if (preferredName !== null) {
      changes.push(`📛 Name: ${preferredName}`);
    }
    if (pronouns !== null) {
      changes.push(`🏷️ Pronouns: ${pronouns}`);
    }
    if (content !== null) {
      changes.push(`📝 Content: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
    }

    const responseContent =
      changes.length > 0
        ? `✅ **Persona updated!**\n\n${changes.join('\n')}`
        : '✅ **Persona saved!** (All fields cleared)';

    await interaction.reply({
      content: responseContent,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Persona] Failed to save persona');
    await interaction.reply({
      content: '❌ Failed to save your persona. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
