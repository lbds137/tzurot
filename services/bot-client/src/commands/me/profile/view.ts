/**
 * Me View Handler
 *
 * Displays the user's current profile information including:
 * - Preferred name
 * - Pronouns
 * - Content/description
 * - Settings (like LTM sharing)
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import {
  MessageFlags,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS, splitMessage } from '@tzurot/common-types';
import { MeCustomIds } from '../../../utils/customIds.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';

const logger = createLogger('me-view');

/** Response type for persona list */
interface PersonaSummary {
  id: string;
  name: string;
  preferredName: string | null;
  description: string | null;
  isDefault: boolean;
  shareLtmAcrossPersonalities: boolean;
}

/** Response type for persona details */
interface PersonaDetails extends PersonaSummary {
  content: string;
  pronouns: string | null;
}

/** Maximum content length to show in embed before truncating */
const CONTENT_PREVIEW_LENGTH = 1000;

/**
 * Handle /me profile view command
 */
export async function handleViewPersona(interaction: ChatInputCommandInteraction): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler
  const discordId = interaction.user.id;

  try {
    // Fetch user's personas via gateway API
    const result = await callGatewayApi<{ personas: PersonaSummary[] }>('/user/persona', {
      userId: discordId,
    });

    if (!result.ok) {
      logger.warn({ userId: discordId, error: result.error }, '[Me] Failed to fetch personas');
      await interaction.editReply({
        content: '❌ Failed to retrieve your profile. Please try again later.',
      });
      return;
    }

    // Find the default persona
    const persona = result.data.personas.find(p => p.isDefault);

    if (persona === undefined) {
      // No personas at all, or no default set
      if (result.data.personas.length === 0) {
        await interaction.editReply({
          content: "❌ You don't have a profile set up yet. Use `/me profile edit` to create one!",
        });
      } else {
        await interaction.editReply({
          content: "❌ You don't have a default profile set. Use `/me profile default` to set one!",
        });
      }
      return;
    }

    // Fetch full persona details (including content) via gateway
    const detailsResult = await callGatewayApi<{ persona: PersonaDetails }>(
      `/user/persona/${persona.id}`,
      {
        userId: discordId,
      }
    );

    if (!detailsResult.ok) {
      logger.warn(
        { userId: discordId, personaId: persona.id, error: detailsResult.error },
        '[Me] Failed to fetch persona details'
      );
      await interaction.editReply({
        content: '❌ Failed to retrieve your profile. Please try again later.',
      });
      return;
    }

    const personaDetails = detailsResult.data.persona;

    // Build embed with profile information
    const embed = new EmbedBuilder()
      .setTitle('🎭 Your Profile')
      .setColor(0x5865f2) // Discord blurple
      .setTimestamp();

    // Add fields
    if (personaDetails.preferredName !== null && personaDetails.preferredName.length > 0) {
      embed.addFields({
        name: '📛 Preferred Name',
        value: personaDetails.preferredName,
        inline: true,
      });
    }

    if (personaDetails.pronouns !== null && personaDetails.pronouns.length > 0) {
      embed.addFields({ name: '🏷️ Pronouns', value: personaDetails.pronouns, inline: true });
    }

    // Settings
    const ltmStatus = personaDetails.shareLtmAcrossPersonalities
      ? '✅ Enabled - Memories shared across all personalities'
      : '❌ Disabled - Memories kept per personality';
    embed.addFields({ name: '🔗 LTM Sharing', value: ltmStatus, inline: false });

    // Content (truncate if too long)
    const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    const isTruncated =
      personaDetails.content !== null && personaDetails.content.length > CONTENT_PREVIEW_LENGTH;

    if (personaDetails.content !== null && personaDetails.content.length > 0) {
      const content = isTruncated
        ? personaDetails.content.substring(0, CONTENT_PREVIEW_LENGTH) + '...'
        : personaDetails.content;
      embed.addFields({ name: '📝 Content', value: content, inline: false });

      // Add expand button if content is truncated
      if (isTruncated) {
        const expandButton = new ButtonBuilder()
          .setCustomId(MeCustomIds.view.expand(personaDetails.id, 'content'))
          .setLabel('Show Full Content')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📖');

        components.push(
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(expandButton)
        );
      }
    } else {
      embed.addFields({
        name: '📝 Content',
        value: '*No content set. Use `/me profile edit` to add information about yourself.*',
        inline: false,
      });
    }

    // Footer with help
    embed.setFooter({
      text: 'Use /me profile edit to update • /me settings to change options',
    });

    await interaction.editReply({
      embeds: [embed],
      components,
    });

    logger.info({ userId: discordId }, '[Me] User viewed their profile');
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me] Failed to view profile');
    await interaction.editReply({
      content: '❌ Failed to retrieve your profile. Please try again later.',
    });
  }
}

/**
 * Handle expand button click to show full content
 */
export async function handleExpandContent(
  interaction: ButtonInteraction,
  personaId: string,
  _field: string
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const discordId = interaction.user.id;

  try {
    // Fetch persona details via gateway (also verifies ownership)
    const result = await callGatewayApi<{ persona: PersonaDetails }>(`/user/persona/${personaId}`, {
      userId: discordId,
    });

    if (!result.ok) {
      logger.warn(
        { userId: discordId, personaId, error: result.error },
        '[Me] Failed to fetch persona for expand'
      );
      await interaction.editReply('❌ Profile not found or access denied.');
      return;
    }

    const content = result.data.persona.content;
    if (content === null || content.length === 0) {
      await interaction.editReply('📝 Content\n\n_Not set_');
      return;
    }

    // Discord message limit
    const MAX_MESSAGE_LENGTH = DISCORD_LIMITS.MESSAGE_LENGTH;
    const header = '📝 Content\n\n';
    const continuedHeader = '📝 Content (continued)\n\n';
    // Use the longer header length to ensure all chunks fit
    const maxHeaderLength = Math.max(header.length, continuedHeader.length);
    const maxContentLength = MAX_MESSAGE_LENGTH - maxHeaderLength;

    if (content.length <= maxContentLength) {
      // Content fits in one message
      await interaction.editReply(`${header}${content}`);
    } else {
      // Use smart chunking that preserves paragraphs, sentences, and code blocks
      const contentChunks = splitMessage(content, maxContentLength);

      // Add headers to each chunk
      const messages = contentChunks.map((chunk, index) => {
        const chunkHeader = index === 0 ? header : continuedHeader;
        return chunkHeader + chunk;
      });

      // Send first chunk as reply
      await interaction.editReply(messages[0]);

      // Send remaining chunks as follow-ups
      for (let i = 1; i < messages.length; i++) {
        await interaction.followUp({
          content: messages[i],
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    logger.info({ userId: discordId, personaId }, '[Me] User expanded profile content');
  } catch (error) {
    logger.error({ err: error, personaId }, '[Me] Failed to expand profile content');
    await interaction.editReply('❌ Failed to load content. Please try again.');
  }
}
