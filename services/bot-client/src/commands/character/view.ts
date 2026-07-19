/**
 * Character View Subcommand - Handles /character view
 */

import {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
  escapeMarkdown,
  type ButtonInteraction,
} from 'discord.js';
import { type EnvConfig } from '@tzurot/common-types/config/config';
import { DISCORD_COLORS, CHARACTER_VIEW_LIMITS } from '@tzurot/common-types/constants/discord';
import { characterViewOptions } from '@tzurot/common-types/generated/commandOptions';
import { formatDateShort } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { GatewayApiError, type UserClient } from '@tzurot/clients';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { CharacterData } from './characterTypes.js';
import { CharacterCustomIds } from '../../utils/customIds.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { replyError } from '../../utils/dashboard/replyError.js';
import { toCharacterData } from './api.js';
import {
  VIEW_TOTAL_PAGES,
  VIEW_PAGE_TITLES,
  EXPANDABLE_FIELDS,
  truncateField,
  getConfiguredFields,
} from './viewTypes.js';
import {
  USE_COMPONENTS_V2,
  buildCharacterViewV2,
  buildViewV2Notice,
  viewAvatarUrl,
} from './viewV2.js';
import { sendChunkedReply } from '../../utils/chunkedReply.js';

const logger = createLogger('character-view');

/** Rendered read-failure line for this view's fetch catches. */
const readFailure = (error: unknown, resource: string): string =>
  renderSpec(classifyGatewayFailure(error, resource, { operation: 'read' }));

/** Result from building a view page */
interface ViewPageResult {
  embed: EmbedBuilder;
  truncatedFields: string[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build overview description for character view
 */
function buildOverviewDescription(character: CharacterData): string {
  const filled = getConfiguredFields(character);
  const lines: string[] = [];
  if (filled.length > 0) {
    lines.push(`**Configured:** ${filled.join(', ')}`);
  }
  lines.push('');
  lines.push('*Use the buttons below to navigate through all character details.*');
  return lines.join('\n');
}

/**
 * Build page 0: Overview & Identity
 */
function buildOverviewPage(
  character: CharacterData,
  embed: EmbedBuilder,
  truncatedFields: string[]
): void {
  embed.setDescription(buildOverviewDescription(character));

  embed.addFields(
    {
      name: '🏷️ Identity',
      value:
        `**Name:** ${escapeMarkdown(character.name)}\n` +
        `**Display Name:** ${character.displayName !== null && character.displayName !== undefined ? escapeMarkdown(character.displayName) : '_Not set_'}\n` +
        `**Slug:** \`${character.slug}\``,
      inline: false,
    },
    {
      name: '⚙️ Settings',
      value:
        `**Visibility:** ${character.isPublic ? '🌐 Public' : '🔒 Private'}\n` +
        `**Voice:** ${character.voiceEnabled ? '🎤 Enabled' : '❌ Disabled'}\n` +
        `**Images:** ${character.imageEnabled ? '🖼️ Enabled' : '❌ Disabled'}`,
      inline: false,
    }
  );

  const traits = truncateField(character.personalityTraits, CHARACTER_VIEW_LIMITS.MEDIUM);
  if (traits.wasTruncated) {
    truncatedFields.push('personalityTraits');
  }
  embed.addFields({ name: '🎭 Personality Traits', value: traits.value, inline: false });

  embed.addFields(
    { name: '🎨 Tone', value: character.personalityTone ?? '_Not set_', inline: true },
    { name: '📅 Age', value: character.personalityAge ?? '_Not set_', inline: true }
  );
}

/**
 * Build page 1: Biography & Appearance
 */
function buildBiographyPage(
  character: CharacterData,
  embed: EmbedBuilder,
  truncatedFields: string[]
): void {
  const charInfo = truncateField(character.characterInfo);
  const appearance = truncateField(character.personalityAppearance);
  if (charInfo.wasTruncated) {
    truncatedFields.push('characterInfo');
  }
  if (appearance.wasTruncated) {
    truncatedFields.push('personalityAppearance');
  }
  embed.addFields(
    { name: '📝 Character Info', value: charInfo.value, inline: false },
    { name: '👤 Appearance', value: appearance.value, inline: false }
  );
}

/**
 * Build page 2: Preferences (Likes/Dislikes)
 */
function buildPreferencesPage(
  character: CharacterData,
  embed: EmbedBuilder,
  truncatedFields: string[]
): void {
  const likes = truncateField(character.personalityLikes);
  const dislikes = truncateField(character.personalityDislikes);
  if (likes.wasTruncated) {
    truncatedFields.push('personalityLikes');
  }
  if (dislikes.wasTruncated) {
    truncatedFields.push('personalityDislikes');
  }
  embed.addFields(
    { name: '❤️ Likes', value: likes.value, inline: false },
    { name: '💔 Dislikes', value: dislikes.value, inline: false }
  );
}

/**
 * Build page 3: Conversation & Errors
 */
function buildConversationPage(
  character: CharacterData,
  embed: EmbedBuilder,
  truncatedFields: string[]
): void {
  const goals = truncateField(character.conversationalGoals);
  const examples = truncateField(character.conversationalExamples);
  const errorMsg = truncateField(character.errorMessage, CHARACTER_VIEW_LIMITS.MEDIUM);
  if (goals.wasTruncated) {
    truncatedFields.push('conversationalGoals');
  }
  if (examples.wasTruncated) {
    truncatedFields.push('conversationalExamples');
  }
  if (errorMsg.wasTruncated) {
    truncatedFields.push('errorMessage');
  }
  embed.addFields(
    { name: '🎯 Conversational Goals', value: goals.value, inline: false },
    { name: '💬 Example Dialogues', value: examples.value, inline: false },
    { name: '⚠️ Error Message', value: errorMsg.value, inline: false }
  );
}

/** Page builder functions by page number */
const PAGE_BUILDERS = [
  buildOverviewPage,
  buildBiographyPage,
  buildPreferencesPage,
  buildConversationPage,
];

/**
 * Build the single-page view shown when the requester can't see the card
 * (definitionRedacted). Without this, the nulled card fields render as
 * "_Not set_" everywhere and a complete character reads as abandoned.
 * Exported for browse-detail, which shows the same state instead of a
 * dashboard full of "_Not configured_" section previews.
 */
export function buildRedactedViewPage(character: CharacterData): ViewPageResult {
  const displayName = escapeMarkdown(character.displayName ?? character.name);
  const embed = new EmbedBuilder()
    .setTitle(`👁️ ${displayName}`)
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTimestamp()
    .setDescription(
      "🔒 **This character's definition is private.**\n" +
        'The creator has chosen not to share the character card. ' +
        'You can still chat with this character normally.'
    )
    .addFields({
      name: '🏷️ Identity',
      value:
        `**Name:** ${escapeMarkdown(character.name)}\n` +
        `**Display Name:** ${character.displayName !== null && character.displayName !== undefined ? escapeMarkdown(character.displayName) : '_Not set_'}\n` +
        `**Slug:** \`${character.slug}\``,
      inline: false,
    });

  const created = formatDateShort(character.createdAt);
  const updated = formatDateShort(character.updatedAt);
  embed.setFooter({ text: `Created: ${created} • Updated: ${updated}` });

  return { embed, truncatedFields: [] };
}

/**
 * Build a single page of the character view embed
 */
function buildCharacterViewPage(character: CharacterData, page: number): ViewPageResult {
  if (character.definitionRedacted) {
    return buildRedactedViewPage(character);
  }

  const displayName = escapeMarkdown(character.displayName ?? character.name);
  const safePage = Math.max(0, Math.min(page, VIEW_TOTAL_PAGES - 1));
  const truncatedFields: string[] = [];

  const embed = new EmbedBuilder()
    .setTitle(`👁️ ${displayName} — ${VIEW_PAGE_TITLES[safePage]}`)
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTimestamp();

  // Build the appropriate page content
  PAGE_BUILDERS[safePage](character, embed, truncatedFields);

  // Add footer with timestamps
  const created = formatDateShort(character.createdAt);
  const updated = formatDateShort(character.updatedAt);
  embed.setFooter({ text: `Created: ${created} • Updated: ${updated}` });

  return { embed, truncatedFields };
}

/**
 * Build pagination and expand buttons for character view
 * Returns array of action rows (pagination + expand buttons if needed)
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Builds pagination buttons, expand/collapse toggles per truncated field, and conditional page info display
function buildViewComponents(
  slug: string,
  currentPage: number,
  truncatedFields: string[]
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Navigation row
  const navRow = new ActionRowBuilder<ButtonBuilder>();
  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.viewPage(slug, currentPage - 1))
      .setLabel('Previous')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.viewInfo(slug))
      .setLabel(`Page ${currentPage + 1} of ${VIEW_TOTAL_PAGES}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.viewPage(slug, currentPage + 1))
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= VIEW_TOTAL_PAGES - 1)
  );
  rows.push(navRow);

  // Add expand buttons for truncated fields (max 5 buttons per row, max 4 additional rows)
  if (truncatedFields.length > 0) {
    let expandRow = new ActionRowBuilder<ButtonBuilder>();
    let buttonCount = 0;

    for (const fieldName of truncatedFields) {
      const fieldInfo = EXPANDABLE_FIELDS[fieldName];
      if (fieldInfo === undefined) {
        continue;
      }

      // Max 5 buttons per row
      if (buttonCount >= 5) {
        rows.push(expandRow);
        expandRow = new ActionRowBuilder<ButtonBuilder>();
        buttonCount = 0;
        // Discord max 5 rows total, we used 1 for nav
        if (rows.length >= 5) {
          break;
        }
      }

      expandRow.addComponents(
        new ButtonBuilder()
          .setCustomId(CharacterCustomIds.expand(slug, fieldName))
          .setLabel(fieldInfo.label.replace(/^[^\s]+\s/, '')) // Remove emoji prefix from field label
          .setEmoji('📖')
          .setStyle(ButtonStyle.Primary)
      );
      buttonCount++;
    }

    if (buttonCount > 0 && rows.length < 5) {
      rows.push(expandRow);
    }
  }

  return rows;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch a character by slug. Local helper (separate from `api.ts`'s
 * `fetchCharacter`) because the view command only needs the response shape
 * and intentionally discards the `canEdit` field. Coercion goes through
 * `api.ts:toCharacterData` so the schema/local-type bridge stays in one place.
 */
async function fetchCharacterForView(
  slug: string,
  userClient: UserClient
): Promise<CharacterData | null> {
  const result = await userClient.getPersonality(slug);

  if (!result.ok) {
    if (result.status === 404 || result.status === 403) {
      // 403 → absence deliberately (privacy: "not visible" ≡ "not found").
      return null;
    }
    // Typed throw preserves the transport kind for honest classification.
    throw new GatewayApiError(
      `Failed to fetch character: ${result.status} - ${result.error}`,
      result.status,
      result.kind
    );
  }

  return toCharacterData(result.data.personality);
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

/**
 * Handle /character view subcommand
 */
export async function handleView(
  context: DeferredCommandContext,
  _config: EnvConfig
): Promise<void> {
  const options = characterViewOptions(context.interaction);
  const slug = options.character();

  try {
    const { userClient } = clientsFor(context.interaction);
    const character = await fetchCharacterForView(slug, userClient);
    if (!character) {
      await context.editReply(
        renderSpec(CATALOG.error.notFound('Character', { name: escapeMarkdown(slug) }))
      );
      return;
    }

    // Build paginated view starting at page 0. The redacted view is a single
    // informational page — no pagination or expand buttons.
    if (USE_COMPONENTS_V2) {
      const view = buildCharacterViewV2(character, 0, viewAvatarUrl(character));
      await context.editReply({
        components: view.components,
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const { embed, truncatedFields } = buildCharacterViewPage(character, 0);
    const components = character.definitionRedacted
      ? []
      : buildViewComponents(slug, 0, truncatedFields);

    await context.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to view character');
    await context.editReply(readFailure(error, 'character'));
  }
}

/**
 * Handle view pagination button clicks
 */
export async function handleViewPagination(
  interaction: ButtonInteraction,
  slug: string,
  page: number,
  _config: EnvConfig
): Promise<void> {
  await interaction.deferUpdate();

  try {
    const { userClient } = clientsFor(interaction);
    const character = await fetchCharacterForView(slug, userClient);
    if (!character) {
      const notFoundText = renderSpec(CATALOG.error.notFound('Character'));
      if (USE_COMPONENTS_V2) {
        // The V2 flag is permanent on the message and forbids `content`
        // edits, so the notice must also ship as a component tree + flag —
        // a flag-less content edit is rejected and the user sees nothing.
        await interaction.editReply({
          components: buildViewV2Notice(notFoundText).components,
          flags: MessageFlags.IsComponentsV2,
        });
        return;
      }
      await interaction.editReply({
        content: notFoundText,
        embeds: [],
        components: [],
      });
      return;
    }

    // Build requested page (a stale pagination click on a now-redacted
    // character collapses to the single redacted page with no components)
    if (USE_COMPONENTS_V2) {
      // The flag must ride EVERY edit — page flips are editReply edits, and
      // an edit without it could degrade the message out of V2 rendering.
      const view = buildCharacterViewV2(character, page, viewAvatarUrl(character));
      await interaction.editReply({
        components: view.components,
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const { embed, truncatedFields } = buildCharacterViewPage(character, page);
    const components = character.definitionRedacted
      ? []
      : buildViewComponents(slug, page, truncatedFields);

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error, slug, page }, 'Failed to load character view page');
    // Keep existing content on error - user can try again
  }
}

/**
 * Handle expand field button - show full content in follow-up message
 */
export async function handleExpandField(
  interaction: ButtonInteraction,
  slug: string,
  fieldName: string,
  _config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { userClient } = clientsFor(interaction);
    const character = await fetchCharacterForView(slug, userClient);
    if (!character) {
      await replyError(interaction, renderSpec(CATALOG.error.notFound('Character')));
      return;
    }

    // Get field info
    const fieldInfo = EXPANDABLE_FIELDS[fieldName];
    if (fieldInfo === undefined) {
      await replyError(interaction, renderSpec(CATALOG.error.validation('Unknown field.')));
      return;
    }

    // A stale expand button on a now-redacted character must not read as
    // "field is empty" — name the privacy state.
    if (character.definitionRedacted) {
      await interaction.editReply("🔒 This character's definition is private.");
      return;
    }

    // Get the full content
    const content = character[fieldInfo.key] as string | null;
    if (content === null || content === undefined || content.length === 0) {
      await interaction.editReply(`${fieldInfo.label}\n\n_Not set_`);
      return;
    }

    await sendChunkedReply({
      interaction,
      content,
      header: `${fieldInfo.label}\n\n`,
      continuedHeader: `${fieldInfo.label} (continued)\n\n`,
    });

    logger.info({ slug, fieldName }, 'Expanded field content shown');
  } catch (error) {
    logger.error({ err: error, slug, fieldName }, 'Failed to expand field');
    await replyError(interaction, readFailure(error, 'field content'));
  }
}

// ============================================================================
// TEST EXPORTS
// ============================================================================

/** @internal Export for testing */
export const _testExports = {
  buildCharacterViewPage,
  truncateField,
  buildViewComponents,
  VIEW_TOTAL_PAGES,
  VIEW_PAGE_TITLES,
  EXPANDABLE_FIELDS,
};
