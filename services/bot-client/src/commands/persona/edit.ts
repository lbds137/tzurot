/**
 * Persona Edit Handler
 *
 * Allows users to edit their persona information via a Discord modal:
 * - Preferred name
 * - Pronouns
 * - Content/description (what AI should know about them)
 */

import {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, getPrismaClient, DISCORD_LIMITS } from '@tzurot/common-types';

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
        defaultPersonaLink: {
          select: {
            persona: {
              select: {
                preferredName: true,
                pronouns: true,
                content: true,
              },
            },
          },
        },
      },
    });

    const persona = user?.defaultPersonaLink?.persona;

    // Build the modal
    const modal = new ModalBuilder().setCustomId('persona-edit').setTitle('Edit Your Persona');

    // Preferred Name input
    const nameInput = new TextInputBuilder()
      .setCustomId('preferredName')
      .setLabel('Preferred Name')
      .setPlaceholder('What should AI call you?')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(255)
      .setRequired(false);

    if (persona?.preferredName !== null && persona?.preferredName !== undefined) {
      nameInput.setValue(persona.preferredName);
    }

    // Pronouns input
    const pronounsInput = new TextInputBuilder()
      .setCustomId('pronouns')
      .setLabel('Pronouns')
      .setPlaceholder('e.g., she/her, he/him, they/them')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(false);

    if (persona?.pronouns !== null && persona?.pronouns !== undefined) {
      pronounsInput.setValue(persona.pronouns);
    }

    // Content input (longer text)
    const contentInput = new TextInputBuilder()
      .setCustomId('content')
      .setLabel('About You')
      .setPlaceholder(
        'Tell the AI about yourself: interests, personality, context it should know...'
      )
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH)
      .setRequired(false);

    if (persona?.content !== null && persona?.content !== undefined) {
      // Discord modals have a max length for pre-filled values
      const truncatedContent =
        persona.content.length > DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH
          ? persona.content.substring(0, DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH)
          : persona.content;
      contentInput.setValue(truncatedContent);
    }

    // Add inputs to action rows (one input per row for modals)
    const nameRow = new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput);
    const pronounsRow = new ActionRowBuilder<TextInputBuilder>().addComponents(pronounsInput);
    const contentRow = new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput);

    modal.addComponents(nameRow, pronounsRow, contentRow);

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
        defaultPersonaLink: {
          select: {
            personaId: true,
          },
        },
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
        defaultPersonaLink: {
          select: {
            personaId: true,
          },
        },
      },
    });

    const existingPersonaId = user.defaultPersonaLink?.personaId;

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
    } else {
      // Create new persona and link it
      const newPersona = await prisma.persona.create({
        data: {
          name: `${interaction.user.username}'s Persona`,
          preferredName,
          pronouns,
          content: content ?? '',
          ownerId: user.id,
        },
      });

      // Create the default persona link
      await prisma.userDefaultPersona.create({
        data: {
          userId: user.id,
          personaId: newPersona.id,
        },
      });

      logger.info(
        { userId: discordId, personaId: newPersona.id },
        '[Persona] Created new persona and linked as default'
      );
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
