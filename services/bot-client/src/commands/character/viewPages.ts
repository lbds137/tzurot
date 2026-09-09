/**
 * Character View Page Builders - Embed page construction for /character view
 */

import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { DISCORD_COLORS, CHARACTER_VIEW_LIMITS } from '@tzurot/common-types/constants/discord';
import { UX_SENTINELS } from '@tzurot/common-types/constants/uxVocabulary';
import { formatDateShort } from '@tzurot/common-types/utils/dateFormatting';
import type { CharacterData } from './characterTypes.js';
import { cappedInlineField, clampEmbedText, EMBED_CAPS } from '../../utils/embedLimits.js';
import { addTagsEmbedField } from './tagsRendering.js';
import {
  VIEW_TOTAL_PAGES,
  VIEW_PAGE_TITLES,
  truncateField,
  getConfiguredFields,
} from './viewTypes.js';

/** Result from building a view page */
interface ViewPageResult {
  embed: EmbedBuilder;
  truncatedFields: string[];
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
 * Build page 0: Overview & Identity
 */
function buildOverviewPage(
  character: CharacterData,
  embed: EmbedBuilder,
  truncatedFields: string[]
): void {
  embed.setDescription(buildOverviewDescription(character));

  embed.addFields({
    name: '🪪 Identity',
    // Clamped: two escaped 255-char names (escaping can double each) exceed
    // the 1024-char field cap, and discord.js THROWS rather than truncating.
    value: clampEmbedText(
      `**Name:** ${escapeMarkdown(character.name)}\n` +
        `**Display Name:** ${character.displayName !== null && character.displayName !== undefined ? escapeMarkdown(character.displayName) : UX_SENTINELS.NOT_SET}\n` +
        `**Slug:** \`${character.slug}\``,
      EMBED_CAPS.fieldValue
    ),
    inline: false,
  });

  addTagsEmbedField(character.tags, embed);

  embed.addFields({
    name: '⚙️ Settings',
    value:
      `**Visibility:** ${character.isPublic ? '🌐 Public' : '🔒 Private'}\n` +
      `**Voice:** ${character.voiceEnabled ? '🎤 Enabled' : '❌ Disabled'}\n` +
      `**Images:** ${character.imageEnabled ? '🖼️ Enabled' : '❌ Disabled'}`,
    inline: false,
  });

  const traits = truncateField(character.personalityTraits, CHARACTER_VIEW_LIMITS.MEDIUM);
  if (traits.wasTruncated) {
    truncatedFields.push('personalityTraits');
  }
  embed.addFields({ name: '🎭 Personality Traits', value: traits.value, inline: false });

  embed.addFields(
    cappedInlineField('🎨 Tone', character.personalityTone ?? UX_SENTINELS.NOT_SET),
    cappedInlineField('📅 Age', character.personalityAge ?? UX_SENTINELS.NOT_SET)
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
    .setTitle(clampEmbedText(`👁️ ${displayName}`, EMBED_CAPS.title))
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTimestamp()
    .setDescription(
      "🔒 **This character's definition is private.**\n" +
        'The creator has chosen not to share the character card. ' +
        'You can still chat with this character normally.'
    )
    .addFields({
      name: '🪪 Identity',
      // Same clamp as buildOverviewPage's Identity field — this is the same
      // concatenation, reachable via browse's redacted detail view.
      value: clampEmbedText(
        `**Name:** ${escapeMarkdown(character.name)}\n` +
          `**Display Name:** ${character.displayName !== null && character.displayName !== undefined ? escapeMarkdown(character.displayName) : UX_SENTINELS.NOT_SET}\n` +
          `**Slug:** \`${character.slug}\``,
        EMBED_CAPS.fieldValue
      ),
      inline: false,
    });

  // Tags survive redaction gateway-side, so the private-definition view still
  // shows them — they are how a non-owner finds the character at all.
  addTagsEmbedField(character.tags, embed);

  // Static dates by necessity: embed FOOTERS don't render <t:> markup, so
  // the §2.5 dynamic-timestamp rule can't apply here (same carve-out class
  // as file exports).
  const created = formatDateShort(character.createdAt);
  const updated = formatDateShort(character.updatedAt);
  embed.setFooter({ text: `Created: ${created} • Updated: ${updated}` });

  return { embed, truncatedFields: [] };
}

/**
 * Build a single page of the character view embed
 */
export function buildCharacterViewPage(character: CharacterData, page: number): ViewPageResult {
  if (character.definitionRedacted) {
    return buildRedactedViewPage(character);
  }

  const displayName = escapeMarkdown(character.displayName ?? character.name);
  const safePage = Math.max(0, Math.min(page, VIEW_TOTAL_PAGES - 1));
  const truncatedFields: string[] = [];

  const embed = new EmbedBuilder()
    .setTitle(clampEmbedText(`👁️ ${displayName} — ${VIEW_PAGE_TITLES[safePage]}`, EMBED_CAPS.title))
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
