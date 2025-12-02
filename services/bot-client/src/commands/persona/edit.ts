/**
 * Persona Edit Handler
 *
 * Allows users to edit their persona information via a Discord modal:
 * - Persona name (identifier for the persona)
 * - Preferred name (what AI calls the user)
 * - Pronouns
 * - Content/description (what AI should know about them)
 *
 * If no persona is specified, edits the user's default persona.
 * If user has no default persona, creates one.
 */

import { MessageFlags, ModalBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, getPrismaClient, DISCORD_LIMITS } from '@tzurot/common-types';
import { buildPersonaModalFields } from './utils/modalBuilder.js';
import { personaCacheInvalidationService } from '../../redis.js';

const logger = createLogger('persona-edit');

/**
 * Handle /persona edit [persona] command - shows modal
 *
 * @param interaction - The command interaction
 * @param personaId - Optional persona ID from autocomplete. If null, edit default persona.
 */
export async function handleEditPersona(
  interaction: ChatInputCommandInteraction,
  personaId?: string | null
): Promise<void> {
  const prisma = getPrismaClient();
  const discordId = interaction.user.id;

  try {
    // Get user with their default persona or the specified persona
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        id: true,
        defaultPersonaId: true,
      },
    });

    let persona: {
      id: string;
      name: string;
      description: string | null;
      preferredName: string | null;
      pronouns: string | null;
      content: string | null;
    } | null = null;

    // Determine which persona to edit
    const targetPersonaId = personaId ?? user?.defaultPersonaId;

    if (targetPersonaId !== null && targetPersonaId !== undefined) {
      // Fetch the specific persona (verify ownership)
      persona = await prisma.persona.findFirst({
        where: {
          id: targetPersonaId,
          ownerId: user?.id,
        },
        select: {
          id: true,
          name: true,
          description: true,
          preferredName: true,
          pronouns: true,
          content: true,
        },
      });

      // If persona ID was specified but not found, error out
      if (persona === null && personaId !== null && personaId !== undefined) {
        await interaction.reply({
          content: '❌ Persona not found. Use `/persona list` to see your personas.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // Build the modal
    // Store persona ID in customId if editing existing, or 'new' if creating
    const modalCustomId = persona !== null ? `persona-edit-${persona.id}` : 'persona-edit-new';

    const modalTitle =
      persona !== null
        ? `Edit: ${persona.name.substring(0, DISCORD_LIMITS.MODAL_TITLE_DYNAMIC_CONTENT)}`
        : 'Create Your Persona';

    const modal = new ModalBuilder().setCustomId(modalCustomId).setTitle(modalTitle);

    const inputFields = buildPersonaModalFields(persona);
    modal.addComponents(...inputFields);

    await interaction.showModal(modal);
    logger.info(
      { userId: discordId, personaId: persona?.id ?? 'new' },
      '[Persona] Showed edit modal'
    );
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
 *
 * @param interaction - The modal submit interaction
 * @param personaId - Persona ID from modal customId, or 'new' for creating
 */
export async function handleEditModalSubmit(
  interaction: ModalSubmitInteraction,
  personaId: string
): Promise<void> {
  const prisma = getPrismaClient();
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

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        id: true,
        defaultPersonaId: true,
      },
    });

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

    if (personaId === 'new') {
      // Create new persona
      const newPersona = await prisma.persona.create({
        data: {
          name: personaName,
          description,
          preferredName,
          pronouns,
          content: content ?? '',
          ownerId: user.id,
        },
      });

      // Set as default if user has no default
      const setAsDefault = user.defaultPersonaId === null;
      if (setAsDefault) {
        await prisma.user.update({
          where: { id: user.id },
          data: { defaultPersonaId: newPersona.id },
        });
      }

      logger.info(
        { userId: discordId, personaId: newPersona.id, personaName },
        '[Persona] Created new persona from edit'
      );

      await personaCacheInvalidationService.invalidateUserPersona(discordId);

      let response = `✅ **Persona "${personaName}" created!**`;
      if (setAsDefault) {
        response += '\n\n⭐ This persona has been set as your default.';
      }
      await interaction.reply({
        content: response,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      // Update existing persona (verify ownership)
      const existingPersona = await prisma.persona.findFirst({
        where: {
          id: personaId,
          ownerId: user.id,
        },
      });

      if (existingPersona === null) {
        await interaction.reply({
          content:
            '❌ Persona not found or you do not own it. Use `/persona list` to see your personas.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.persona.update({
        where: { id: personaId },
        data: {
          name: personaName,
          description,
          preferredName,
          pronouns,
          content: content ?? '',
          updatedAt: new Date(),
        },
      });

      logger.info(
        { userId: discordId, personaId, personaName },
        '[Persona] Updated existing persona'
      );

      await personaCacheInvalidationService.invalidateUserPersona(discordId);

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
          ? `✅ **Persona updated!**\n\n${changes.join('\n')}`
          : '✅ **Persona saved!** (All optional fields cleared)';

      await interaction.reply({
        content: responseContent,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Persona] Failed to save persona');
    await interaction.reply({
      content: '❌ Failed to save your persona. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
