/**
 * Deny Detail Types and Builders
 *
 * Shared types, constants, and UI builder functions used by both
 * detail.ts (main handlers) and detailEdit.ts (edit handlers).
 */

import { ButtonBuilder, ButtonStyle, ActionRowBuilder, type EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import {
  type DenylistEntityType,
  type DenylistScope,
  type DenylistMode,
} from '@tzurot/common-types/schemas/api/denylist';
import { formatDateShort } from '@tzurot/common-types/utils/dateFormatting';
import { buildEntityDetailCard } from '../../utils/detailCard.js';
import type { BrowseContext } from '../../utils/dashboard/types.js';
import type { DenylistEntryResponse } from './browseTypes.js';

/** Entity type key for Redis session storage */
export const ENTITY_TYPE = 'deny';

/** Valid scope values; `satisfies` makes sync with schema's DenylistScope compiler-enforced. */
export const VALID_SCOPES = [
  'BOT',
  'GUILD',
  'CHANNEL',
  'PERSONALITY',
] as const satisfies readonly DenylistScope[];

/** Session data stored in Redis */
export interface DenyDetailSession {
  id: string;
  type: DenylistEntityType;
  discordId: string;
  scope: DenylistScope;
  scopeId: string;
  mode: DenylistMode;
  reason: string | null;
  addedAt: string; // ISO string in Redis; Date on fetch — buildDetailEmbed accepts both
  addedBy: string;
  /**
   * Browse context for the dashboard's Back-to-Browse path. `null` when the
   * detail view was opened directly via `/deny view` (target-by-ID lookup);
   * in that case there's no browse list to return to and the post-action
   * helper renders a clean terminal instead of rebuilding browse.
   */
  browseContext: BrowseContext | null;
  guildId: string | null;
}

/** Accepts Date (fresh fetch) or string (Redis-rehydrated session) for addedAt. */
export function buildDetailEmbed(
  entry: Omit<DenylistEntryResponse, 'addedAt'> & { addedAt: Date | string }
): EmbedBuilder {
  const target =
    entry.type === 'USER'
      ? `<@${entry.discordId}> (\`${entry.discordId}\`)`
      : `\`${entry.discordId}\` (Guild)`;

  const modeIcon = entry.mode === 'BLOCK' ? '\u{1F6AB}' : '\u{1F507}';
  const scopeInfo = entry.scope === 'BOT' ? 'Bot-wide' : `${entry.scope}: \`${entry.scopeId}\``;

  return buildEntityDetailCard({
    title: `${modeIcon} Denylist Entry`,
    color: entry.mode === 'BLOCK' ? DISCORD_COLORS.ERROR : DISCORD_COLORS.WARNING,
    // Spacers close each row at 2 cells so Target/Type and Mode/Scope align
    // vertically in Discord's 3-column field grid.
    fields: [
      { name: 'Target', value: target, inline: true },
      { name: 'Type', value: entry.type, inline: true },
      'spacer',
      { name: 'Mode', value: `${modeIcon} ${entry.mode}`, inline: true },
      { name: 'Scope', value: scopeInfo, inline: true },
      'spacer',
      entry.reason !== null && { name: 'Reason', value: entry.reason, inline: false },
    ],
    footer: `Added ${formatDateShort(entry.addedAt)} \u2022 ID: ${entry.id}`,
    timestamp: true,
  }).embed;
}

/** Build action buttons for the detail view */
export function buildDetailButtons(
  entryId: string,
  mode: string,
  hasBrowseContext: boolean
): ActionRowBuilder<ButtonBuilder>[] {
  const toggleLabel = mode === 'BLOCK' ? 'Switch to Mute' : 'Switch to Block';
  const toggleEmoji = mode === 'BLOCK' ? '\u{1F507}' : '\u{1F6AB}';

  const row2 = new ActionRowBuilder<ButtonBuilder>();
  // Back-to-Browse only makes sense when the detail view was opened from
  // `/deny browse`. The `/deny view` entry point sets browseContext=null —
  // no list to return to, so omit the button rather than render one that
  // leads to "session expired".
  if (hasBrowseContext) {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`deny::back::${entryId}`)
        .setLabel('Back to Browse')
        .setEmoji('\u25C0\uFE0F')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  row2.addComponents(
    new ButtonBuilder()
      .setCustomId(`deny::del::${entryId}`)
      .setLabel('Delete')
      .setEmoji('\u{1F5D1}\uFE0F')
      .setStyle(ButtonStyle.Danger)
  );

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`deny::edit::${entryId}`)
        .setLabel('Edit')
        .setEmoji('\u270F\uFE0F')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`deny::mode::${entryId}`)
        .setLabel(toggleLabel)
        .setEmoji(toggleEmoji)
        .setStyle(ButtonStyle.Secondary)
    ),
    row2,
  ];
}
