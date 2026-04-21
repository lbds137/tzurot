/**
 * Dashboard delete action handlers.
 *
 * Handles the delete confirmation flow for character dashboards:
 * - Show confirmation dialog from dashboard delete button
 * - Process confirm/cancel responses
 */

import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import {
  createLogger,
  DeletePersonalityResponseSchema,
  type EnvConfig,
} from '@tzurot/common-types';
import { buildDeleteConfirmation } from '../../utils/dashboard/deleteConfirmation.js';
import { DASHBOARD_MESSAGES, formatSuccessBanner } from '../../utils/dashboard/messages.js';
import { getSessionManager } from '../../utils/dashboard/SessionManager.js';
import { renderPostActionScreen } from '../../utils/dashboard/postActionScreen.js';
import { CharacterCustomIds } from '../../utils/customIds.js';
import { fetchCharacter } from './api.js';
import { callGatewayApi, toGatewayUser } from '../../utils/userGatewayClient.js';
import type { CharacterData } from './characterTypes.js';

const logger = createLogger('character-dashboard');

/**
 * Handle delete button click from dashboard - show confirmation dialog
 */
export async function handleDeleteAction(
  interaction: ButtonInteraction,
  slug: string,
  config: EnvConfig
): Promise<void> {
  // Re-fetch to verify current state and permissions
  const character = await fetchCharacter(slug, config, toGatewayUser(interaction.user));
  if (!character) {
    await interaction.reply({
      content: DASHBOARD_MESSAGES.NOT_FOUND('Character'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Verify user can delete
  if (!character.canEdit) {
    await interaction.reply({
      content: DASHBOARD_MESSAGES.NO_PERMISSION('delete this character'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Build confirmation dialog using shared utility
  const displayName = character.displayName ?? character.name;
  const { embed, components } = buildDeleteConfirmation({
    entityType: 'Character',
    entityName: displayName,
    confirmCustomId: CharacterCustomIds.deleteConfirm(slug),
    cancelCustomId: CharacterCustomIds.deleteCancel(slug),
    title: '⚠️ Delete Character?',
    confirmLabel: 'Delete Forever',
    deletedItems: [
      'Conversation history',
      'Long-term memories',
      'Pending memories',
      'Activated channels',
      'Aliases',
      'Cached avatar',
    ],
  });

  await interaction.update({ embeds: [embed], components });

  logger.info({ userId: interaction.user.id, slug }, 'Showing delete confirmation from dashboard');
}

/**
 * Handle delete confirmation button click.
 * Called when user clicks "Delete Forever" or "Cancel" on the delete confirmation dialog.
 *
 * Success routes through {@link renderPostActionScreen} — direct re-render of
 * the browse list with a banner in `content` when the user came from
 * `/character browse`, or a clean terminal otherwise. Error paths render as a
 * terminal with Back-to-Browse where applicable.
 *
 * The cancel path is left non-terminal (plain empty-components reply +
 * `intentionally-raw:` marker) — ideally it would restore the dashboard,
 * but character's dashboard renders its own embed without a shared refresh
 * helper. Tracked as a follow-up.
 */
export async function handleDeleteButton(
  interaction: ButtonInteraction,
  slug: string,
  confirmed: boolean
): Promise<void> {
  if (!confirmed) {
    // Cancel-delete is non-terminal — ideally it restores the dashboard (like
    // preset's handleCancelDeleteButton via refreshDashboardUI), but
    // character's dashboard renders its own embed without a shared refresh
    // helper. Tracked as a follow-up backlog item ("character cancel-delete
    // should restore dashboard").
    await interaction.update({
      content: '✅ Deletion cancelled.',
      embeds: [],
      // intentionally-raw: non-terminal cancel path; see block comment above.
      components: [],
    });
    return;
  }

  // User clicked confirm — ack the button. No intermediate "Deleting..."
  // message; the user sees the button's spinner while the DELETE resolves.
  await interaction.deferUpdate();

  // Fetch the session so browseContext (if any) can carry into the post-action
  // screen. Users who opened this dashboard from /character browse get the
  // refreshed browse list with a success banner; users who opened it via
  // /character view get a clean terminal state.
  const sessionManager = getSessionManager();
  const session = await sessionManager.get<CharacterData>(interaction.user.id, 'character', slug);
  const postActionSession = {
    userId: interaction.user.id,
    entityType: 'character' as const,
    entityId: slug,
    browseContext: session?.data.browseContext,
  };

  // Wrap the API call + response handling in try/catch so network errors
  // (fetch throws, timeout, DNS failure) don't propagate up to CommandHandler's
  // generic error reply. Matches the preset pattern.
  try {
    const result = await callGatewayApi<unknown>(`/user/personality/${slug}`, {
      method: 'DELETE',
      user: toGatewayUser(interaction.user),
    });

    if (!result.ok) {
      logger.error({ slug, error: result.error }, '[Character] Delete API failed');
      await renderPostActionScreen({
        interaction,
        session: postActionSession,
        outcome: { kind: 'error', content: `❌ Failed to delete character: ${result.error}` },
      });
      return;
    }

    // Validate response against schema (contract validation)
    const parseResult = DeletePersonalityResponseSchema.safeParse(result.data);
    if (!parseResult.success) {
      logger.error(
        { slug, parseError: parseResult.error.message },
        '[Character] Response schema validation failed'
      );
      // Still consider it a success since the API returned 200
      await renderPostActionScreen({
        interaction,
        session: postActionSession,
        outcome: { kind: 'success', banner: formatSuccessBanner('Deleted character', slug) },
      });
      return;
    }

    const { deletedCounts: counts, deletedName, deletedSlug } = parseResult.data;

    // Build the secondary detail block (deletion counts) shown below the
    // banner in the success content. Filter out zero counts for terseness.
    const countLines = [
      counts.conversationHistory > 0 && `• ${counts.conversationHistory} conversation message(s)`,
      counts.memories > 0 &&
        `• ${counts.memories} long-term memor${counts.memories === 1 ? 'y' : 'ies'}`,
      counts.pendingMemories > 0 &&
        `• ${counts.pendingMemories} pending memor${counts.pendingMemories === 1 ? 'y' : 'ies'}`,
      counts.channelSettings > 0 && `• ${counts.channelSettings} channel setting(s)`,
      counts.aliases > 0 && `• ${counts.aliases} alias(es)`,
    ].filter((line): line is string => typeof line === 'string');

    let banner = formatSuccessBanner('Deleted character', deletedName);
    if (countLines.length > 0) {
      banner += '\n**Deleted data:**\n' + countLines.join('\n');
    }

    await renderPostActionScreen({
      interaction,
      session: postActionSession,
      outcome: { kind: 'success', banner },
    });

    logger.info(
      { userId: interaction.user.id, slug: deletedSlug, counts },
      '[Character] Successfully deleted character'
    );
  } catch (error) {
    logger.error({ err: error, slug }, '[Character] Failed to delete character');
    await renderPostActionScreen({
      interaction,
      session: postActionSession,
      outcome: {
        kind: 'error',
        content: '❌ An error occurred while deleting the character. Please try again.',
      },
    });
  }
}
