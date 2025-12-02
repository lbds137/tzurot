/**
 * Persona Override Handlers
 *
 * Allows users to set different personas for specific personalities.
 * This enables per-personality customization while keeping a default persona.
 */

import { MessageFlags, ModalBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, getPrismaClient, DISCORD_LIMITS } from '@tzurot/common-types';
import { buildPersonaInputFields } from './utils/modalBuilder.js';
import { personaCacheInvalidationService } from '../../redis.js';

const logger = createLogger('persona-override');

/**
 * Handle /persona override set <personality> - Opens modal to create override persona
 */
export async function handleOverrideSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const prisma = getPrismaClient();
  const discordId = interaction.user.id;
  const personalitySlug = interaction.options.getString('personality', true);

  try {
    // Find personality by slug
    const personality = await prisma.personality.findUnique({
      where: { slug: personalitySlug },
      select: {
        id: true,
        name: true,
        displayName: true,
      },
    });

    if (personality === null) {
      await interaction.reply({
        content: `❌ Personality "${personalitySlug}" not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        id: true,
        personalityConfigs: {
          where: { personalityId: personality.id },
          select: {
            id: true,
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

    if (user === null) {
      await interaction.reply({
        content:
          "❌ You don't have an account yet. Send a message to any personality to create one!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get existing override persona values if any
    const existingConfig = user.personalityConfigs[0];
    const existingPersona = existingConfig?.persona;

    // Build the modal with personality-specific labels
    const personalityName = personality.displayName ?? personality.name;
    const modal = new ModalBuilder()
      .setCustomId(`persona-override-${personality.id}`)
      .setTitle(`Persona for ${personalityName.substring(0, DISCORD_LIMITS.MODAL_TITLE_DYNAMIC_CONTENT)}`);

    const inputFields = buildPersonaInputFields(existingPersona, {
      namePlaceholder: `What should ${personalityName} call you?`,
      contentLabel: `About You (for ${personalityName})`,
      contentPlaceholder: `Tell ${personalityName} specific things about yourself...`,
    });
    modal.addComponents(...inputFields);

    await interaction.showModal(modal);
    logger.info(
      { userId: discordId, personalityId: personality.id },
      '[Persona] Showed override set modal'
    );
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Persona] Failed to show override set modal');
    await interaction.reply({
      content: '❌ Failed to open override dialog. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle modal submission for persona override
 */
export async function handleOverrideModalSubmit(
  interaction: ModalSubmitInteraction,
  personalityId: string
): Promise<void> {
  const prisma = getPrismaClient();
  const discordId = interaction.user.id;

  try {
    // Get values from modal
    const preferredName = interaction.fields.getTextInputValue('preferredName').trim() || null;
    const pronouns = interaction.fields.getTextInputValue('pronouns').trim() || null;
    const content = interaction.fields.getTextInputValue('content').trim() || null;

    // Find user
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        id: true,
        personalityConfigs: {
          where: { personalityId },
          select: {
            id: true,
            personaId: true,
          },
        },
      },
    });

    if (user === null) {
      await interaction.reply({
        content: '❌ User not found.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get personality name for response
    const personality = await prisma.personality.findUnique({
      where: { id: personalityId },
      select: { name: true, displayName: true },
    });
    const personalityName = personality?.displayName ?? personality?.name ?? 'Unknown';

    const existingConfig = user.personalityConfigs[0];

    if (existingConfig?.personaId !== null && existingConfig?.personaId !== undefined) {
      // Update existing override persona
      await prisma.persona.update({
        where: { id: existingConfig.personaId },
        data: {
          preferredName,
          pronouns,
          content: content ?? '',
          updatedAt: new Date(),
        },
      });

      logger.info(
        { userId: discordId, personalityId, personaId: existingConfig.personaId },
        '[Persona] Updated override persona'
      );

      // Broadcast cache invalidation to all ai-worker instances
      await personaCacheInvalidationService.invalidateUserPersona(discordId);
    } else {
      // Create new override persona and link it
      const newPersona = await prisma.persona.create({
        data: {
          name: `${interaction.user.username}'s Persona for ${personalityName}`,
          preferredName,
          pronouns,
          content: content ?? '',
          ownerId: user.id,
        },
      });

      if (existingConfig !== null && existingConfig !== undefined) {
        // Update existing config to link to new persona
        await prisma.userPersonalityConfig.update({
          where: { id: existingConfig.id },
          data: { personaId: newPersona.id },
        });
      } else {
        // Create new config with persona
        await prisma.userPersonalityConfig.create({
          data: {
            userId: user.id,
            personalityId,
            personaId: newPersona.id,
          },
        });
      }

      logger.info(
        { userId: discordId, personalityId, personaId: newPersona.id },
        '[Persona] Created new override persona'
      );

      // Broadcast cache invalidation to all ai-worker instances
      await personaCacheInvalidationService.invalidateUserPersona(discordId);
    }

    await interaction.reply({
      content: `✅ **Persona override set for ${personalityName}!**\n\nThis persona will be used when talking to ${personalityName} instead of your default persona.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logger.error(
      { err: error, userId: discordId, personalityId },
      '[Persona] Failed to save override'
    );
    await interaction.reply({
      content: '❌ Failed to save persona override. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle /persona override clear <personality> - Remove override
 */
export async function handleOverrideClear(interaction: ChatInputCommandInteraction): Promise<void> {
  const prisma = getPrismaClient();
  const discordId = interaction.user.id;
  const personalitySlug = interaction.options.getString('personality', true);

  try {
    // Find personality
    const personality = await prisma.personality.findUnique({
      where: { slug: personalitySlug },
      select: {
        id: true,
        name: true,
        displayName: true,
      },
    });

    if (personality === null) {
      await interaction.reply({
        content: `❌ Personality "${personalitySlug}" not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Find user and their config for this personality
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        id: true,
        personalityConfigs: {
          where: { personalityId: personality.id },
          select: {
            id: true,
            personaId: true,
            llmConfigId: true,
          },
        },
      },
    });

    if (user === null) {
      await interaction.reply({
        content:
          "❌ You don't have an account yet. Send a message to any personality to create one!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existingConfig = user.personalityConfigs[0];
    const personalityName = personality.displayName ?? personality.name;

    if (existingConfig?.personaId === null || existingConfig?.personaId === undefined) {
      await interaction.reply({
        content: `ℹ️ You don't have a persona override set for ${personalityName}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Clear the persona override
    // If config has llmConfigId, just clear personaId; otherwise delete the config
    if (existingConfig.llmConfigId !== null) {
      await prisma.userPersonalityConfig.update({
        where: { id: existingConfig.id },
        data: { personaId: null },
      });
    } else {
      await prisma.userPersonalityConfig.delete({
        where: { id: existingConfig.id },
      });
    }

    // Optionally delete the orphaned persona (if not used elsewhere)
    // For now, we leave it in case user wants to restore it later

    await interaction.reply({
      content: `✅ **Persona override cleared for ${personalityName}!**\n\nYour default persona will now be used when talking to ${personalityName}.`,
      flags: MessageFlags.Ephemeral,
    });

    logger.info(
      { userId: discordId, personalityId: personality.id },
      '[Persona] Cleared persona override'
    );

    // Broadcast cache invalidation to all ai-worker instances
    await personaCacheInvalidationService.invalidateUserPersona(discordId);
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Persona] Failed to clear override');
    await interaction.reply({
      content: '❌ Failed to clear persona override. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
