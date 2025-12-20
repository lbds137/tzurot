/**
 * Character View Subcommand
 * Handles /character view - displays character details with pagination
 */

import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import {
  createLogger,
  type EnvConfig,
  DISCORD_LIMITS,
  DISCORD_COLORS,
  CHARACTER_VIEW_LIMITS,
  TEXT_LIMITS,
  splitMessage,
} from '@tzurot/common-types';
import type { CharacterData } from './config.js';
import { CharacterCustomIds } from '../../utils/customIds.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('character-view');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Number of pages for character view */
export const VIEW_TOTAL_PAGES = 4;

/** Page titles for character view - aligned with edit section names */
export const VIEW_PAGE_TITLES = [
  '🏷️ Identity & Basics',
  '📖 Biography & Appearance',
  '❤️ Preferences',
  '💬 Conversation',
];

/** Map of field names to their display labels and character data keys */
export const EXPANDABLE_FIELDS: Record<string, { label: string; key: keyof CharacterData }> = {
  characterInfo: { label: '📝 Character Info', key: 'characterInfo' },
  personalityTraits: { label: '🎭 Personality Traits', key: 'personalityTraits' },
  personalityTone: { label: '🎨 Tone', key: 'personalityTone' },
  personalityAge: { label: '📅 Age', key: 'personalityAge' },
  personalityAppearance: { label: '👤 Appearance', key: 'personalityAppearance' },
  personalityLikes: { label: '❤️ Likes', key: 'personalityLikes' },
  personalityDislikes: { label: '💔 Dislikes', key: 'personalityDislikes' },
  conversationalGoals: { label: '🎯 Conversational Goals', key: 'conversationalGoals' },
  conversationalExamples: { label: '💬 Example Dialogues', key: 'conversationalExamples' },
  errorMessage: { label: '⚠️ Error Message', key: 'errorMessage' },
};

// ============================================================================
// TYPES
// ============================================================================

/** Field info for tracking truncation */
interface FieldInfo {
  value: string;
  wasTruncated: boolean;
  originalLength: number;
}

/** Result from building a view page */
interface ViewPageResult {
  embed: EmbedBuilder;
  truncatedFields: string[];
}

/** API response type for personality endpoint */
interface PersonalityResponse {
  personality: CharacterData;
  canEdit: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Truncate text to fit Discord embed field limit (1024 chars)
 * Returns info about whether truncation occurred
 */
export function truncateField(
  text: string | null | undefined,
  maxLength = DISCORD_LIMITS.EMBED_FIELD - TEXT_LIMITS.TRUNCATION_SUFFIX.length
): FieldInfo {
  if (text === null || text === undefined || text.length === 0) {
    return { value: '_Not set_', wasTruncated: false, originalLength: 0 };
  }
  // Ensure maxLength doesn't exceed Discord's limit minus suffix
  const safeMax = Math.min(
    maxLength,
    DISCORD_LIMITS.EMBED_FIELD - TEXT_LIMITS.TRUNCATION_SUFFIX.length
  );
  if (text.length <= safeMax) {
    return { value: text, wasTruncated: false, originalLength: text.length };
  }
  return {
    value: text.slice(0, safeMax) + TEXT_LIMITS.TRUNCATION_SUFFIX,
    wasTruncated: true,
    originalLength: text.length,
  };
}

/**
 * Field configuration for character overview status
 */
const OVERVIEW_FIELDS = [
  { key: 'characterInfo' as const, label: 'Background' },
  { key: 'personalityTraits' as const, label: 'Traits' },
  { key: 'personalityTone' as const, label: 'Tone' },
  { key: 'conversationalGoals' as const, label: 'Goals' },
  { key: 'conversationalExamples' as const, label: 'Examples' },
] as const;

/**
 * Get configured field labels from character data
 */
function getConfiguredFields(character: CharacterData): string[] {
  return OVERVIEW_FIELDS.filter(({ key }) => (character[key]?.length ?? 0) > 0).map(
    ({ label }) => label
  );
}

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
 * Build a single page of the character view embed
 */
export function buildCharacterViewPage(character: CharacterData, page: number): ViewPageResult {
  const displayName = character.displayName ?? character.name;
  const safePage = Math.max(0, Math.min(page, VIEW_TOTAL_PAGES - 1));
  const truncatedFields: string[] = [];

  const embed = new EmbedBuilder()
    .setTitle(`👁️ ${displayName} — ${VIEW_PAGE_TITLES[safePage]}`)
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTimestamp();

  switch (safePage) {
    case 0: {
      // Overview & Identity page
      embed.setDescription(buildOverviewDescription(character));

      // Identity info
      embed.addFields(
        {
          name: '🏷️ Identity',
          value:
            `**Name:** ${character.name}\n` +
            `**Display Name:** ${character.displayName ?? '_Not set_'}\n` +
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

      // Add traits, tone, age if set
      const traits = truncateField(character.personalityTraits, CHARACTER_VIEW_LIMITS.MEDIUM);
      if (traits.wasTruncated) {
        truncatedFields.push('personalityTraits');
      }
      embed.addFields({ name: '🎭 Personality Traits', value: traits.value, inline: false });

      // Tone and age inline
      const toneValue = character.personalityTone ?? '_Not set_';
      const ageValue = character.personalityAge ?? '_Not set_';
      embed.addFields(
        { name: '🎨 Tone', value: toneValue, inline: true },
        { name: '📅 Age', value: ageValue, inline: true }
      );
      break;
    }

    case 1: {
      // Biography & Appearance page
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
      break;
    }

    case 2: {
      // Preferences page
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
      break;
    }

    case 3: {
      // Conversation & Errors page
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
      break;
    }
  }

  // Add footer with timestamps
  const created = new Date(character.createdAt).toLocaleDateString();
  const updated = new Date(character.updatedAt).toLocaleDateString();
  embed.setFooter({ text: `Created: ${created} • Updated: ${updated}` });

  return { embed, truncatedFields };
}

/**
 * Build pagination and expand buttons for character view
 * Returns array of action rows (pagination + expand buttons if needed)
 */
export function buildViewComponents(
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
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.viewInfo(slug))
      .setLabel(`Page ${currentPage + 1} of ${VIEW_TOTAL_PAGES}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.viewPage(slug, currentPage + 1))
      .setLabel('Next ▶')
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
          .setLabel(`📖 ${fieldInfo.label.replace(/^[^\s]+\s/, '')}`) // Remove emoji prefix
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
 * Fetch a character by slug
 */
async function fetchCharacter(slug: string, userId: string): Promise<CharacterData | null> {
  const result = await callGatewayApi<PersonalityResponse>(`/user/personality/${slug}`, {
    userId,
  });

  if (!result.ok) {
    if (result.status === 404 || result.status === 403) {
      return null;
    }
    throw new Error(`Failed to fetch character: ${result.status}`);
  }

  return result.data.personality;
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

/**
 * Handle /character view subcommand
 */
export async function handleView(
  interaction: ChatInputCommandInteraction,
  _config: EnvConfig
): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler
  const slug = interaction.options.getString('character', true);

  try {
    const character = await fetchCharacter(slug, interaction.user.id);
    if (!character) {
      await interaction.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }

    // Build paginated view starting at page 0
    const { embed, truncatedFields } = buildCharacterViewPage(character, 0);
    const components = buildViewComponents(slug, 0, truncatedFields);

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to view character');
    await interaction.editReply('❌ Failed to load character. Please try again.');
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
    const character = await fetchCharacter(slug, interaction.user.id);
    if (!character) {
      await interaction.editReply({
        content: '❌ Character not found.',
        embeds: [],
        components: [],
      });
      return;
    }

    // Build requested page
    const { embed, truncatedFields } = buildCharacterViewPage(character, page);
    const components = buildViewComponents(slug, page, truncatedFields);

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
    const character = await fetchCharacter(slug, interaction.user.id);
    if (!character) {
      await interaction.editReply('❌ Character not found.');
      return;
    }

    // Get field info
    const fieldInfo = EXPANDABLE_FIELDS[fieldName];
    if (fieldInfo === undefined) {
      await interaction.editReply('❌ Unknown field.');
      return;
    }

    // Get the full content
    const content = character[fieldInfo.key] as string | null;
    if (content === null || content === undefined || content.length === 0) {
      await interaction.editReply(`${fieldInfo.label}\n\n_Not set_`);
      return;
    }

    // Discord message limit
    const MAX_MESSAGE_LENGTH = DISCORD_LIMITS.MESSAGE_LENGTH;
    const header = `${fieldInfo.label}\n\n`;
    const continuedHeader = `${fieldInfo.label} (continued)\n\n`;
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

    logger.info({ slug, fieldName }, 'Expanded field content shown');
  } catch (error) {
    logger.error({ err: error, slug, fieldName }, 'Failed to expand field');
    await interaction.editReply('❌ Failed to load field content. Please try again.');
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
