/**
 * Components-V2 renderer for /character view (design-system D17 pilot).
 *
 * A RENDERER SWAP, not a redesign (council-decided): same four pages, same
 * field-to-page mapping, same truncation caps and customIds as the embed
 * renderer in view.ts. What V2 adds:
 *
 * - Header Section with the character's avatar as a Thumbnail accessory
 *   (page 0 only; omitted gracefully when no avatar exists) — the embed
 *   view never showed avatars at all.
 * - Per-field expand: each truncated long-text field is a Section carrying
 *   its own 📖 Button accessory, adjacent to the text it expands — instead
 *   of pooled button rows the reader has to positionally match to fields.
 * - Separators between field groups; the date footer as `-#` subtext.
 *
 * `USE_COMPONENTS_V2` is the kill switch: one-line revert to the embed
 * renderer, which stays intact for the pilot comparison. Deliberately NO
 * runtime fallback to embeds — a V2 failure is pilot data and must surface,
 * not be masked.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  escapeMarkdown,
} from 'discord.js';
import { DISCORD_COLORS, CHARACTER_VIEW_LIMITS } from '@tzurot/common-types/constants/discord';
import { formatDateShort } from '@tzurot/common-types/utils/dateFormatting';
import { CharacterCustomIds } from '../../utils/customIds.js';
import type { CharacterData } from './characterTypes.js';
import {
  VIEW_TOTAL_PAGES,
  VIEW_PAGE_TITLES,
  EXPANDABLE_FIELDS,
  truncateField,
  getConfiguredFields,
} from './viewTypes.js';

/**
 * Kill switch for the pilot: flip to false for a one-line revert to the
 * embed renderer. Remove (along with the embed path) once the pilot verdict
 * lands.
 */
export const USE_COMPONENTS_V2 = true;

/** One rendered block on a page. */
interface ViewBlock {
  /** Markdown body (label heading + value). */
  text: string;
  /** Set when the block is a truncated expandable field → Section + 📖. */
  expandKey?: string;
}

export interface ViewV2Result {
  components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[];
}

/**
 * Public avatar URL for a character, or null when it has none. Consumes the
 * API's gateway-derived `avatarUrl` — the thumbnail is fetched by DISCORD's
 * media proxy, so it needs the PUBLIC gateway host, which only the gateway
 * process knows (bot-client's own gateway base URL is the internal hostname
 * and produced a broken image here; export.ts can use it only because the
 * BOT does that fetch itself).
 */
export function viewAvatarUrl(character: CharacterData): string | null {
  return character.avatarUrl ?? null;
}

/** Label + truncated value as one markdown block, flagging expandability. */
function fieldBlock(character: CharacterData, fieldName: string, maxLength?: number): ViewBlock {
  const info = EXPANDABLE_FIELDS[fieldName];
  const raw = character[info.key] as string | null;
  const truncated = truncateField(raw, maxLength);
  return {
    text: `**${info.label}**\n${truncated.value}`,
    expandKey: truncated.wasTruncated ? fieldName : undefined,
  };
}

/** Identity block shared by page 0 and the redacted view. */
function identityBlock(character: CharacterData): string {
  const displayName =
    character.displayName !== null && character.displayName !== undefined
      ? escapeMarkdown(character.displayName)
      : '_Not set_';
  return (
    `**🏷️ Identity**\n` +
    `**Name:** ${escapeMarkdown(character.name)}\n` +
    `**Display Name:** ${displayName}\n` +
    `**Slug:** \`${character.slug}\``
  );
}

/** Mirrors the embed view's overview description (configured-fields line + hint). */
function overviewDescription(character: CharacterData): string {
  const filledLabels = getConfiguredFields(character);
  const lines: string[] = [];
  if (filledLabels.length > 0) {
    lines.push(`**Configured:** ${filledLabels.join(', ')}`);
  }
  lines.push('');
  lines.push('*Use the buttons below to navigate through all character details.*');
  return lines.join('\n');
}

function overviewBlocks(character: CharacterData): ViewBlock[] {
  const settings =
    `**⚙️ Settings**\n` +
    `**Visibility:** ${character.isPublic ? '🌐 Public' : '🔒 Private'}\n` +
    `**Voice:** ${character.voiceEnabled ? '🎤 Enabled' : '❌ Disabled'}\n` +
    `**Images:** ${character.imageEnabled ? '🖼️ Enabled' : '❌ Disabled'}`;

  // Tone and Age are SEPARATE blocks, mirroring the embed view's separate
  // inline fields — a mid-line `·` join scrunched Age onto the tail of an
  // arbitrarily long Tone paragraph (owner eval finding).
  const tone = `**🎨 Tone**\n${character.personalityTone ?? '_Not set_'}`;
  const age = `**📅 Age**\n${character.personalityAge ?? '_Not set_'}`;

  return [
    { text: overviewDescription(character) },
    { text: identityBlock(character) },
    { text: settings },
    fieldBlock(character, 'personalityTraits', CHARACTER_VIEW_LIMITS.MEDIUM),
    { text: tone },
    { text: age },
  ];
}

/** Page → blocks, mirroring the embed PAGE_BUILDERS field-for-field. */
function pageBlocks(character: CharacterData, page: number): ViewBlock[] {
  switch (page) {
    case 1:
      return [
        fieldBlock(character, 'characterInfo'),
        fieldBlock(character, 'personalityAppearance'),
      ];
    case 2:
      return [
        fieldBlock(character, 'personalityLikes'),
        fieldBlock(character, 'personalityDislikes'),
      ];
    case 3:
      return [
        fieldBlock(character, 'conversationalGoals'),
        fieldBlock(character, 'conversationalExamples'),
        fieldBlock(character, 'errorMessage', CHARACTER_VIEW_LIMITS.MEDIUM),
      ];
    default:
      return overviewBlocks(character);
  }
}

/** Expandable-and-truncated → Section with a 📖 accessory; else TextDisplay. */
function appendBlock(container: ContainerBuilder, slug: string, block: ViewBlock): void {
  if (block.expandKey === undefined) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block.text));
    return;
  }
  const label = EXPANDABLE_FIELDS[block.expandKey].label.replace(/^[^\s]+\s/, '');
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(block.text))
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(CharacterCustomIds.expand(slug, block.expandKey))
          .setLabel(label)
          .setEmoji('📖')
          .setStyle(ButtonStyle.Primary)
      )
  );
}

function footerText(character: CharacterData): string {
  const created = formatDateShort(character.createdAt);
  const updated = formatDateShort(character.updatedAt);
  return `-# Created: ${created} • Updated: ${updated}`;
}

function navRow(slug: string, currentPage: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
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
}

/**
 * Minimal V2 payload for replacing the view with a plain text notice (e.g.
 * the character 404ing on a stale pagination click). The IsComponentsV2 flag
 * is permanent once set on a message and forbids `content`/`embeds` on
 * subsequent edits, so even error text must ship as a component tree.
 */
export function buildViewV2Notice(text: string): ViewV2Result {
  return {
    components: [
      new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text)),
    ],
  };
}

/** Redacted variant: one Container, no interactive components. */
function buildRedactedV2(character: CharacterData): ViewV2Result {
  const displayName = escapeMarkdown(character.displayName ?? character.name);
  const container = new ContainerBuilder()
    .setAccentColor(DISCORD_COLORS.BLURPLE)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## 👁️ ${displayName}`),
      new TextDisplayBuilder().setContent(
        "🔒 **This character's definition is private.**\n" +
          'The creator has chosen not to share the character card. ' +
          'You can still chat with this character normally.'
      )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(identityBlock(character)),
      new TextDisplayBuilder().setContent(footerText(character))
    );
  return { components: [container] };
}

/**
 * Build one page of the character view as a Components-V2 tree. Mirrors the
 * embed renderer's content exactly; only the substrate differs.
 */
export function buildCharacterViewV2(
  character: CharacterData,
  page: number,
  avatarUrl: string | null
): ViewV2Result {
  if (character.definitionRedacted) {
    return buildRedactedV2(character);
  }

  const displayName = escapeMarkdown(character.displayName ?? character.name);
  const safePage = Math.max(0, Math.min(page, VIEW_TOTAL_PAGES - 1));
  const title = `## 👁️ ${displayName} — ${VIEW_PAGE_TITLES[safePage]}`;

  const container = new ContainerBuilder().setAccentColor(DISCORD_COLORS.BLURPLE);

  // Header: page 0 carries the avatar as a Section Thumbnail (council call:
  // identity artifact, page 0 only). A Section REQUIRES an accessory, so
  // when there is no avatar the header is a plain TextDisplay.
  if (safePage === 0 && avatarUrl !== null) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(title))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl))
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(title));
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  for (const block of pageBlocks(character, safePage)) {
    appendBlock(container, character.slug, block);
  }

  container
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText(character)));

  return { components: [container, navRow(character.slug, safePage)] };
}
