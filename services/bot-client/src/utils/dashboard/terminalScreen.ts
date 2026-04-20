/**
 * Dashboard Terminal Screen Renderer
 *
 * Shared helper for rendering the "final" screen of a dashboard interaction —
 * the state shown after a terminal action like delete, archive, or
 * set-default completes (successfully or with an error).
 *
 * Why this exists: dashboards opened from `/<cmd> browse` must always offer a
 * Back-to-Browse affordance so the user isn't stranded after the action. Each
 * terminal handler independently assembling its own `editReply` makes it easy
 * to drop that affordance — we've shipped at least one bug of that shape
 * (preset delete in PR #836). This helper centralises the contract so:
 *
 *  - If `session.browseContext` is present, the screen renders with a
 *    "Back to Browse" button (custom ID `<entityType>::back::<entityId>`)
 *    and the session stays alive so the command's existing `handleBackButton`
 *    can consume the context on click.
 *  - If not, the screen renders with no components and the session is
 *    cleaned up immediately.
 *
 * Enforcement is via `dashboardTerminalScreen.structure.test.ts` which flags
 * raw `components: []` in the files listed there — authors either route
 * through this helper or add a deliberate opt-out comment.
 */

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
  /**
   * Session handle for the entity whose dashboard we're closing out. When
   * `browseContext` is present, the helper keeps the session alive and
   * attaches a back button. When absent (or when `session` itself is null),
   * the helper deletes the session and renders a terminal, button-less
   * screen.
   */
  session: TerminalScreenSession | null;
  /** Body text. Shown as `content` on the reply. */
  content: string;
  /** Optional embeds alongside the content. */
  embeds?: (APIEmbed | EmbedBuilder)[];
}

/**
 * Render the final screen of a dashboard terminal action.
 *
 * Assumes the interaction has already been deferred (callers that went
 * through `interaction.deferUpdate()` or `requireDeferredSession` are fine).
 */
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
    // Keep the session alive — the back button handler reads `browseContext`
    // from it and performs its own cleanup.
    await interaction.editReply({ content, embeds, components: [backRow] });
    return;
  }

  if (session !== null) {
    await sessionManager.delete(session.userId, session.entityType, session.entityId);
  }
  await interaction.editReply({ content, embeds, components: [] });
}
