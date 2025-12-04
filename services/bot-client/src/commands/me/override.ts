/**
 * Me Override Handlers
 *
 * Allows users to set different profiles for specific personalities.
 * This enables per-personality customization while keeping a default profile.
 *
 * Flow:
 * - /me override set <personality> <profile> - Set existing profile or create new
 * - If user selects "Create new profile..." option, shows a modal
 * - Otherwise, directly assigns the selected profile
 */

import { MessageFlags, ModalBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, getPrismaClient, DISCORD_LIMITS } from '@tzurot/common-types';
import { CREATE_NEW_PERSONA_VALUE } from './autocomplete.js';
import { buildPersonaModalFields } from './utils/modalBuilder.js';
import { personaCacheInvalidationService } from '../../redis.js';

const logger = createLogger('me-override');

/**
 * Handle /me override set <personality> <profile> command
 *
 * If profile is CREATE_NEW_PERSONA_VALUE, shows modal to create new profile.
 * Otherwise, directly sets the selected profile as override.
 */
export async function handleOverrideSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const prisma = getPrismaClient();
  const discordId = interaction.user.id;
  const personalitySlug = interaction.options.getString('personality', true);
  const personaId = interaction.options.getString('profile', true);

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

    const personalityName = personality.displayName ?? personality.name;

    // Check if user wants to create a new profile
    if (personaId === CREATE_NEW_PERSONA_VALUE) {
      // Show modal to create new profile for this personality
      const modal = new ModalBuilder()
        .setCustomId(`me-override-create-${personality.id}`)
        .setTitle(
          `New Persona for ${personalityName.substring(0, DISCORD_LIMITS.MODAL_TITLE_DYNAMIC_CONTENT)}`
        );

      const inputFields = buildPersonaModalFields(null, {
        namePlaceholder: `e.g., "My ${personalityName} Persona"`,
        preferredNameLabel: `Preferred Name (what ${personalityName} calls you)`,
        preferredNamePlaceholder: `What should ${personalityName} call you?`,
        contentLabel: `About You (for ${personalityName})`,
        contentPlaceholder: `Tell ${personalityName} specific things about yourself...`,
      });
      modal.addComponents(...inputFields);

      await interaction.showModal(modal);
      logger.info(
        { userId: discordId, personalityId: personality.id },
        '[Me] Showed create-for-override modal'
      );
      return;
    }

    // User selected an existing profile - verify ownership
    const persona = await prisma.persona.findFirst({
      where: {
        id: personaId,
        ownerId: user.id,
      },
      select: {
        id: true,
        name: true,
        preferredName: true,
      },
    });

    if (persona === null) {
      await interaction.reply({
        content: '❌ Profile not found. Use `/me list` to see your profiles.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get existing config for this personality
    const existingConfig = await prisma.userPersonalityConfig.findUnique({
      where: {
        userId_personalityId: {
          userId: user.id,
          personalityId: personality.id,
        },
      },
    });

    if (existingConfig !== null) {
      // Update existing config
      await prisma.userPersonalityConfig.update({
        where: { id: existingConfig.id },
        data: { personaId: persona.id },
      });
    } else {
      // Create new config
      await prisma.userPersonalityConfig.create({
        data: {
          userId: user.id,
          personalityId: personality.id,
          personaId: persona.id,
        },
      });
    }

    // Broadcast cache invalidation
    await personaCacheInvalidationService.invalidateUserPersona(discordId);

    const displayName = persona.preferredName ?? persona.name;
    logger.info(
      { userId: discordId, personalityId: personality.id, personaId: persona.id },
      '[Me] Set override profile'
    );

    await interaction.reply({
      content: `✅ **Profile override set for ${personalityName}!**\n\n📋 Using: **${displayName}**\n\nThis profile will be used when talking to ${personalityName} instead of your default profile.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me] Failed to set override');
    await interaction.reply({
      content: '❌ Failed to set profile override. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle modal submission for creating a new profile during override
 * Modal customId format: me-override-create-{personalityId}
 */
export async function handleOverrideCreateModalSubmit(
  interaction: ModalSubmitInteraction,
  personalityId: string
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

    // Profile name is required
    if (personaName.length === 0) {
      await interaction.reply({
        content: '❌ Profile name is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: { id: true },
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

    // Create the new profile
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

    // Set up the override config
    const existingConfig = await prisma.userPersonalityConfig.findUnique({
      where: {
        userId_personalityId: {
          userId: user.id,
          personalityId,
        },
      },
    });

    if (existingConfig !== null) {
      await prisma.userPersonalityConfig.update({
        where: { id: existingConfig.id },
        data: { personaId: newPersona.id },
      });
    } else {
      await prisma.userPersonalityConfig.create({
        data: {
          userId: user.id,
          personalityId,
          personaId: newPersona.id,
        },
      });
    }

    logger.info(
      { userId: discordId, personalityId, personaId: newPersona.id, personaName },
      '[Me] Created new profile and set as override'
    );

    // Broadcast cache invalidation
    await personaCacheInvalidationService.invalidateUserPersona(discordId);

    await interaction.reply({
      content:
        `✅ **Profile "${personaName}" created and set as override for ${personalityName}!**\n\n` +
        `This profile will be used when talking to ${personalityName}.\n\n` +
        `Use \`/me list\` to see all your profiles.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logger.error(
      { err: error, userId: discordId, personalityId },
      '[Me] Failed to create override profile'
    );
    await interaction.reply({
      content: '❌ Failed to create profile. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle /me override clear <personality> - Remove override
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
        content: `ℹ️ You don't have a profile override set for ${personalityName}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Clear the profile override
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

    logger.info(
      { userId: discordId, personalityId: personality.id },
      '[Me] Cleared profile override'
    );

    // Broadcast cache invalidation BEFORE replying to ensure consistency
    await personaCacheInvalidationService.invalidateUserPersona(discordId);

    await interaction.reply({
      content: `✅ **Profile override cleared for ${personalityName}!**\n\nYour default profile will now be used when talking to ${personalityName}.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me] Failed to clear override');
    await interaction.reply({
      content: '❌ Failed to clear profile override. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
