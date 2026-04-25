/**
 * Interactive components (buttons + select menu) for the inspect command
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { DebugViewType } from './types.js';
import { InspectCustomIds } from './customIds.js';

/**
 * Format a byte count for compact display in a button label.
 * 0 → null (caller should hide the hint)
 * 1-999 → "(N)"
 * 1k-99k → "(X.Xk)"
 * 100k+ → "(XXk)"
 */
function formatByteHint(chars: number): string | null {
  if (chars <= 0) {
    return null;
  }
  if (chars < 1000) {
    return `(${chars})`;
  }
  if (chars < 100_000) {
    return `(${(chars / 1000).toFixed(1)}k)`;
  }
  return `(${Math.round(chars / 1000)}k)`;
}

/**
 * Build the button row and select menu row for the diagnostic summary embed.
 *
 * @param requestId - Diagnostic request UUID for routing button/select clicks back
 * @param thinkingContentLength - Length of extracted reasoning content; surfaced
 *   as a byte hint on the "View Reasoning" button label so users can tell at a
 *   glance whether reasoning is a 200-char preview or a 50KB monster before clicking
 */
export function buildInspectComponents(
  requestId: string,
  thinkingContentLength = 0
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const byteHint = formatByteHint(thinkingContentLength);
  const reasoningLabel = byteHint !== null ? `View Reasoning ${byteHint}` : 'View Reasoning';

  const buttonRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(InspectCustomIds.button(requestId, DebugViewType.Reasoning))
      .setLabel(reasoningLabel)
      .setEmoji('💭')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(InspectCustomIds.button(requestId, DebugViewType.FullJson))
      .setLabel('Full JSON')
      .setEmoji('📄')
      .setStyle(ButtonStyle.Secondary)
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(InspectCustomIds.selectMenu(requestId))
    .setPlaceholder('More diagnostic views…')
    .addOptions(
      {
        label: 'Compact JSON',
        description: 'JSON with system prompt summarized',
        value: DebugViewType.CompactJson,
        emoji: '📋',
      },
      {
        label: 'System Prompt (XML)',
        description: 'Extracted system prompt in XML wrapper',
        value: DebugViewType.SystemPrompt,
        emoji: '📃',
      },
      {
        label: 'Memory Inspector',
        description: 'Search query, scored memories, inclusion status',
        value: DebugViewType.MemoryInspector,
        emoji: '🧠',
      },
      {
        label: 'Token Budget',
        description: 'ASCII breakdown of context window allocation',
        value: DebugViewType.TokenBudget,
        emoji: '📊',
      }
    );

  const selectRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    selectMenu
  );

  return [buttonRow, selectRow];
}
