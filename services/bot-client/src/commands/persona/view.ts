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
import type { ButtonInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS, splitMessage } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { PersonaCustomIds } from '../../utils/customIds.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('persona-view');

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

/** Build embed and action row for profile view */
function buildProfileEmbed(personaDetails: PersonaDetails): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} {
  const embed = new EmbedBuilder().setTitle('🎭 Your Profile').setColor(0x5865f2).setTimestamp();

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

  const ltmStatus = personaDetails.shareLtmAcrossPersonalities
    ? '✅ Enabled - Memories shared across all personalities'
    : '❌ Disabled - Memories kept per personality';
  embed.addFields({ name: '🔗 LTM Sharing', value: ltmStatus, inline: false });

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  const contentText = personaDetails.content;
  const hasContent = contentText !== null && contentText.length > 0;
  const isTruncated = hasContent && contentText.length > CONTENT_PREVIEW_LENGTH;

  if (hasContent && contentText !== null) {
    const content = isTruncated
      ? contentText.substring(0, CONTENT_PREVIEW_LENGTH) + '...'
      : contentText;
    embed.addFields({ name: '📝 Content', value: content, inline: false });

    if (isTruncated) {
      const expandButton = new ButtonBuilder()
        .setCustomId(PersonaCustomIds.expand(personaDetails.id, 'content'))
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

  embed.setFooter({ text: 'Use /me profile edit to update • /me settings to change options' });
  return { embed, components };
}

/**
 * Handle /me profile view command
 */
export async function handleViewPersona(context: DeferredCommandContext): Promise<void> {
  const discordId = context.user.id;

  try {
    const result = await callGatewayApi<{ personas: PersonaSummary[] }>('/user/persona', {
      userId: discordId,
    });

    if (!result.ok) {
      logger.warn({ userId: discordId, error: result.error }, '[Persona] Failed to fetch personas');
      await context.editReply({
        content: '❌ Failed to retrieve your profile. Please try again later.',
      });
      return;
    }

    const persona = result.data.personas.find(p => p.isDefault);
    if (persona === undefined) {
      const message =
        result.data.personas.length === 0
          ? "❌ You don't have a profile set up yet. Use `/me profile edit` to create one!"
          : "❌ You don't have a default profile set. Use `/me profile default` to set one!";
      await context.editReply({ content: message });
      return;
    }

    const detailsResult = await callGatewayApi<{ persona: PersonaDetails }>(
      `/user/persona/${persona.id}`,
      { userId: discordId }
    );

    if (!detailsResult.ok) {
      logger.warn(
        { userId: discordId, personaId: persona.id, error: detailsResult.error },
        '[Persona] Failed to fetch persona details'
      );
      await context.editReply({
        content: '❌ Failed to retrieve your profile. Please try again later.',
      });
      return;
    }

    const { embed, components } = buildProfileEmbed(detailsResult.data.persona);
    await context.editReply({ embeds: [embed], components });
    logger.info({ userId: discordId }, '[Persona] User viewed their profile');
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Persona] Failed to view profile');
    await context.editReply({
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
        '[Persona] Failed to fetch persona for expand'
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

    logger.info({ userId: discordId, personaId }, '[Persona] User expanded profile content');
  } catch (error) {
    logger.error({ err: error, personaId }, '[Persona] Failed to expand profile content');
    await interaction.editReply('❌ Failed to load content. Please try again.');
  }
}
