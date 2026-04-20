// Terminal screen for dashboards opened from /browse: preserves Back-to-Browse when `browseContext` is set, else cleans session. Enforced by terminalScreen.structure.test.ts.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
  type ButtonInteraction,
  type EmbedBuilder,
} from 'discord.js';
import type { BrowseContext } from './types.js';
import { getSessionManager } from './SessionManager.js';

export interface TerminalScreenSession {
  userId: string;
  entityType: string;
  entityId: string;
  browseContext: BrowseContext | undefined;
}

export interface TerminalScreenOptions {
  interaction: ButtonInteraction;
  session: TerminalScreenSession | null;
  content: string;
  embeds?: (APIEmbed | EmbedBuilder)[];
}

// Assumes the interaction is already deferred.
export async function renderTerminalScreen(opts: TerminalScreenOptions): Promise<void> {
  const { interaction, session, content } = opts;
  const embeds = opts.embeds ?? [];
  const sessionManager = getSessionManager();

  const hasBrowseContext = session?.browseContext !== undefined;

  if (hasBrowseContext && session !== null) {
    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${session.entityType}::back::${session.entityId}`)
        .setLabel('Back to Browse')
        .setEmoji('\u25C0\uFE0F')
        .setStyle(ButtonStyle.Secondary)
    );
    // Keep session alive — handleBackButton reads browseContext and cleans it up.
    await interaction.editReply({ content, embeds, components: [backRow] });
    return;
  }

  if (session !== null) {
    await sessionManager.delete(session.userId, session.entityType, session.entityId);
  }
  await interaction.editReply({ content, embeds, components: [] });
}
