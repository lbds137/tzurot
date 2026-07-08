/**
 * Persona View Handler
 *
 * Displays the user's current persona information including:
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
  type ButtonInteraction,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { PersonaCustomIds } from '../../utils/customIds.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { sendChunkedReply } from '../../utils/chunkedReply.js';
import { replyError } from '../../utils/dashboard/replyError.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('persona-view');

const PERSONA_FETCH_ERROR = renderSpec(
  CATALOG.error.transient("Couldn't load your persona right now.")
);
const CONTENT_FIELD_NAME = '📝 Content';

/** Response type for persona list */
interface PersonaSummary {
  id: string;
  name: string;
  preferredName: string | null;
  description: string | null;
  isDefault: boolean;
}

/** Response type for persona details */
interface PersonaDetails extends PersonaSummary {
  content: string;
  pronouns: string | null;
}

/** Maximum content length to show in embed before truncating */
const CONTENT_PREVIEW_LENGTH = 1000;

/** Build embed and action row for persona view */
function buildPersonaEmbed(personaDetails: PersonaDetails): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle('🎭 Your Persona')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTimestamp();

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

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  const contentText = personaDetails.content;
  const hasContent = contentText !== null && contentText.length > 0;
  const isTruncated = hasContent && contentText.length > CONTENT_PREVIEW_LENGTH;

  if (hasContent && contentText !== null) {
    const content = isTruncated
      ? contentText.substring(0, CONTENT_PREVIEW_LENGTH) + '...'
      : contentText;
    embed.addFields({ name: CONTENT_FIELD_NAME, value: content, inline: false });

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
      name: CONTENT_FIELD_NAME,
      value: '*No content set. Use `/persona edit` to add information about yourself.*',
      inline: false,
    });
  }

  embed.setFooter({ text: 'Use /persona edit to update • /settings to change options' });
  return { embed, components };
}

/**
 * Handle /persona view command
 */
export async function handleViewPersona(context: DeferredCommandContext): Promise<void> {
  const discordId = context.user.id;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.listPersonas();

    if (!result.ok) {
      logger.warn({ userId: discordId, error: result.error }, 'Failed to fetch personas');
      await context.editReply({
        content: PERSONA_FETCH_ERROR,
      });
      return;
    }

    const persona = result.data.personas.find(p => p.isDefault);
    if (persona === undefined) {
      const message =
        result.data.personas.length === 0
          ? renderSpec(
              CATALOG.error.notFound('Persona', { hint: 'Use `/persona edit` to create one!' })
            )
          : renderSpec(
              CATALOG.error.notFound('Default persona', {
                hint: 'Use `/persona default` to set one!',
              })
            );
      await context.editReply({ content: message });
      return;
    }

    const detailsResult = await userClient.getPersona(persona.id);

    if (!detailsResult.ok) {
      logger.warn(
        { userId: discordId, personaId: persona.id, error: detailsResult.error },
        'Failed to fetch persona details'
      );
      await context.editReply({
        content: PERSONA_FETCH_ERROR,
      });
      return;
    }

    const { embed, components } = buildPersonaEmbed(detailsResult.data.persona as PersonaDetails);
    await context.editReply({ embeds: [embed], components });
    logger.info({ userId: discordId }, 'User viewed their persona');
  } catch (error) {
    logger.error({ err: error, userId: discordId }, 'Failed to view persona');
    await context.editReply({
      content: PERSONA_FETCH_ERROR,
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
    const { userClient } = clientsFor(interaction);
    const result = await userClient.getPersona(personaId);

    if (!result.ok) {
      logger.warn(
        { userId: discordId, personaId, error: result.error },
        'Failed to fetch persona for expand'
      );
      await replyError(interaction, renderSpec(CATALOG.error.notFound('Persona')));
      return;
    }

    const content = result.data.persona.content;
    if (content === null || content.length === 0) {
      await interaction.editReply('📝 Content\n\n_Not set_');
      return;
    }

    await sendChunkedReply({
      interaction,
      content,
      header: '📝 Content\n\n',
      continuedHeader: '📝 Content (continued)\n\n',
    });

    logger.info({ userId: discordId, personaId }, 'User expanded persona content');
  } catch (error) {
    logger.error({ err: error, personaId }, 'Failed to expand persona content');
    await replyError(
      interaction,
      renderSpec(classifyGatewayFailure(error, 'persona content', { operation: 'read' }))
    );
  }
}
