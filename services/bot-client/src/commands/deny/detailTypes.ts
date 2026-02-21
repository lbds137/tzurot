/**
 * Deny Detail Types and Builders
 *
 * Shared types, constants, and UI builder functions used by both
 * detail.ts (main handlers) and detailEdit.ts (edit handlers).
 */

import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { DISCORD_COLORS, formatDateShort } from '@tzurot/common-types';
import type { DenylistEntryResponse } from './browse.js';

/** Entity type key for Redis session storage */
export const ENTITY_TYPE = 'deny-detail';

/** Valid scope values for denylist entries */
export const VALID_SCOPES = ['BOT', 'GUILD', 'CHANNEL', 'PERSONALITY'] as const;

/** Session data stored in Redis */
export interface DenyDetailSession {
  id: string;
  type: string;
  discordId: string;
  scope: string;
  scopeId: string;
  mode: string;
  reason: string | null;
  addedAt: string;
  addedBy: string;
  browseContext: { page: number; filter: string; sort: string };
  guildId: string | null;
}

/** Build the detail embed for an entry */
export function buildDetailEmbed(entry: DenylistEntryResponse): EmbedBuilder {
  const target =
    entry.type === 'USER'
      ? `<@${entry.discordId}> (\`${entry.discordId}\`)`
      : `\`${entry.discordId}\` (Guild)`;

  const modeIcon = entry.mode === 'BLOCK' ? '\u{1F6AB}' : '\u{1F507}';
  const scopeInfo = entry.scope === 'BOT' ? 'Bot-wide' : `${entry.scope}: \`${entry.scopeId}\``;

  const fields = [
    { name: 'Target', value: target, inline: true },
    { name: 'Type', value: entry.type, inline: true },
    { name: '\u200B', value: '\u200B', inline: true },
    { name: 'Mode', value: `${modeIcon} ${entry.mode}`, inline: true },
    { name: 'Scope', value: scopeInfo, inline: true },
    { name: '\u200B', value: '\u200B', inline: true },
  ];

  if (entry.reason !== null) {
    fields.push({ name: 'Reason', value: entry.reason, inline: false });
  }

  return new EmbedBuilder()
    .setTitle(`${modeIcon} Denylist Entry`)
    .setColor(entry.mode === 'BLOCK' ? DISCORD_COLORS.ERROR : DISCORD_COLORS.WARNING)
    .addFields(fields)
    .setFooter({
      text: `Added ${formatDateShort(entry.addedAt)} \u2022 ID: ${entry.id}`,
    })
    .setTimestamp();
}

/** Build action buttons for the detail view */
export function buildDetailButtons(
  entryId: string,
  mode: string
): ActionRowBuilder<ButtonBuilder>[] {
  const toggleLabel = mode === 'BLOCK' ? 'Switch to Mute' : 'Switch to Block';
  const toggleEmoji = mode === 'BLOCK' ? '\u{1F507}' : '\u{1F6AB}';

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
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`deny::back::${entryId}`)
        .setLabel('Back to Browse')
        .setEmoji('\u25C0\uFE0F')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`deny::del::${entryId}`)
        .setLabel('Delete')
        .setEmoji('\u{1F5D1}\uFE0F')
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}
