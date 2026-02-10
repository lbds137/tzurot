/**
 * Interactive components (buttons + select menu) for the debug command
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { DebugViewType } from './types.js';
import { DebugCustomIds } from './customIds.js';

/**
 * Build the button row and select menu row for the debug summary embed
 */
export function buildDebugComponents(
  requestId: string
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const buttonRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(DebugCustomIds.button(requestId, DebugViewType.Reasoning))
      .setLabel('View Reasoning')
      .setEmoji('\ud83d\udcad')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(DebugCustomIds.button(requestId, DebugViewType.FullJson))
      .setLabel('Full JSON')
      .setEmoji('\ud83d\udcc4')
      .setStyle(ButtonStyle.Secondary)
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(DebugCustomIds.selectMenu(requestId))
    .setPlaceholder('More views...')
    .addOptions(
      {
        label: 'Compact JSON',
        description: 'JSON with system prompt summarized',
        value: DebugViewType.CompactJson,
        emoji: '\ud83d\udccb',
      },
      {
        label: 'System Prompt (XML)',
        description: 'Extracted system prompt in XML wrapper',
        value: DebugViewType.SystemPrompt,
        emoji: '\ud83d\udcc3',
      },
      {
        label: 'Memory Inspector',
        description: 'Search query, scored memories, inclusion status',
        value: DebugViewType.MemoryInspector,
        emoji: '\ud83e\udde0',
      },
      {
        label: 'Token Budget',
        description: 'ASCII breakdown of context window allocation',
        value: DebugViewType.TokenBudget,
        emoji: '\ud83d\udcca',
      }
    );

  const selectRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    selectMenu
  );

  return [buttonRow, selectRow];
}
