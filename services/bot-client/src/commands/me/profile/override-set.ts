/**
 * Me Override Set Handler
 *
 * Allows users to set different profiles for specific personalities.
 * This enables per-personality customization while keeping a default profile.
 *
 * Flow:
 * - /me profile override-set <personality> <profile> - Set existing profile or create new
 * - If user selects "Create new profile..." option, shows a modal
 * - Otherwise, directly assigns the selected profile
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { MessageFlags, ModalBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS, truncateText } from '@tzurot/common-types';
import { CREATE_NEW_PERSONA_VALUE } from '../autocomplete.js';
import { buildPersonaModalFields } from './utils/modalBuilder.js';
import { MeCustomIds } from '../../../utils/customIds.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';

const logger = createLogger('me-override-set');

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

/**
 * Handle /me profile override-set <personality> <profile> command
 *
 * If profile is CREATE_NEW_PERSONA_VALUE, shows modal to create new profile.
 * Otherwise, directly sets the selected profile as override.
 */
export async function handleOverrideSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordId = interaction.user.id;
  const personalitySlug = interaction.options.getString('personality', true);
  const personaId = interaction.options.getString('profile', true);

  try {
    // Check if user wants to create a new profile
    if (personaId === CREATE_NEW_PERSONA_VALUE) {
      // Get personality info via gateway
      const infoResult = await callGatewayApi<OverrideInfoResponse>(
        `/user/persona/override/${personalitySlug}`,
        { userId: discordId }
      );

      if (!infoResult.ok) {
        // Handle specific errors
        if (
          infoResult.error?.includes('Personality not found') ||
          infoResult.error?.includes('not found')
        ) {
          await interaction.reply({
            content: `❌ Personality "${personalitySlug}" not found.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (infoResult.error?.includes('no account') || infoResult.error?.includes('User')) {
          await interaction.reply({
            content:
              "❌ You don't have an account yet. Send a message to any personality to create one!",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content: '❌ Failed to prepare profile creation. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { personality } = infoResult.data;
      const personalityName = personality.displayName ?? personality.name;

      // Show modal to create new profile for this personality
      const modal = new ModalBuilder()
        .setCustomId(MeCustomIds.override.createForOverride(personality.id))
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

      await interaction.showModal(modal);
      logger.info(
        { userId: discordId, personalityId: personality.id },
        '[Me] Showed create-for-override modal'
      );
      return;
    }

    // User selected an existing profile - set override via gateway
    const result = await callGatewayApi<SetOverrideResponse>(
      `/user/persona/override/${personalitySlug}`,
      {
        userId: discordId,
        method: 'PUT',
        body: { personaId },
      }
    );

    if (!result.ok) {
      // Handle specific errors
      if (
        result.error?.includes('Personality not found') ||
        result.error?.includes('personality')
      ) {
        await interaction.reply({
          content: `❌ Personality "${personalitySlug}" not found.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (result.error?.includes('no account') || result.error?.includes('User')) {
        await interaction.reply({
          content:
            "❌ You don't have an account yet. Send a message to any personality to create one!",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (result.error?.includes('Profile not found') || result.error?.includes('Persona')) {
        await interaction.reply({
          content: '❌ Profile not found. Use `/me profile list` to see your profiles.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      logger.warn(
        { userId: discordId, personalitySlug, personaId, error: result.error },
        '[Me] Failed to set override via gateway'
      );
      await interaction.reply({
        content: '❌ Failed to set profile override. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { personality, persona } = result.data;
    const personalityName = personality.displayName ?? personality.name;
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
 * Modal customId format: me::override::create::{personalityId}
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

    // Profile name is required
    if (personaName.length === 0) {
      await interaction.reply({
        content: '❌ Profile name is required.',
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
        '[Me] Failed to create override profile via gateway'
      );
      await interaction.reply({
        content: '❌ Failed to create profile. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { persona, personality } = result.data;
    const personalityName = personality.displayName ?? personality.name;

    logger.info(
      { userId: discordId, personalityId, personaId: persona.id, personaName },
      '[Me] Created new profile and set as override'
    );

    await interaction.reply({
      content:
        `✅ **Profile "${personaName}" created and set as override for ${personalityName}!**\n\n` +
        `This profile will be used when talking to ${personalityName}.\n\n` +
        `Use \`/me profile list\` to see all your profiles.`,
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
