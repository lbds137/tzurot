/**
 * Deny Detail View
 *
 * Shows a detailed view of a single denylist entry with options to
 * toggle mode, edit scope/reason, or delete. Uses Redis-backed sessions
 * for state management.
 *
 * UI builders and types are in detailTypes.ts.
 * Edit modal handlers are in detailEdit.ts.
 *
 * Destructive-action flow: `handleConfirmDelete` routes success/failure
 * through `renderPostActionScreen` (shared with preset/character/persona).
 * Success re-renders the browse list with a banner in `content`; failure
 * renders a terminal with Back-to-Browse. The browse rebuilder is
 * registered in `browse.ts` — it does `fetchEntries` + `buildBrowseResponse`
 * internally so the unified helper works the same across all four commands.
 *
 * `handleModeToggle` keeps plain empty-components replies on its error
 * paths — those are recoverable in-place errors (session still alive, user
 * can retry), not terminal post-actions. Marked `intentionally-raw:` so
 * the structural test catches new terminal paths without false positives
 * on these legitimate non-terminal error renders.
 */

import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, isBotOwner } from '@tzurot/common-types';
import { getSessionManager } from '../../utils/dashboard/SessionManager.js';
import { buildDeleteConfirmation } from '../../utils/dashboard/deleteConfirmation.js';
import { DASHBOARD_MESSAGES, formatSuccessBanner } from '../../utils/dashboard/messages.js';
import { parseDashboardCustomId } from '../../utils/dashboard/types.js';
import { renderPostActionScreen } from '../../utils/dashboard/postActionScreen.js';
import { handleSharedBackButton } from '../../utils/dashboard/sharedBackButtonHandler.js';
import { adminPostJson, adminFetch } from '../../utils/adminApiClient.js';
import type { BrowseContext } from '../../utils/dashboard/types.js';
import type { DenylistEntryResponse } from './browse.js';
import type { DenyDetailSession } from './detailTypes.js';
import { ENTITY_TYPE, buildDetailEmbed, buildDetailButtons } from './detailTypes.js';
import { handleEdit, handleEditModal } from './detailEdit.js';
// Side-effect import: registers the deny browse rebuilder used by
// renderPostActionScreen + handleSharedBackButton.
import './browse.js';

const logger = createLogger('deny-detail');

/** Reply with session expired message (clears embeds/components) */
async function replyExpired(interaction: {
  editReply: ButtonInteraction['editReply'];
}): Promise<void> {
  // intentionally-raw: session-expired helper has no access to browseContext
  // (it's a generic utility called from multiple sites where the caller
  // couldn't even load the session). Recovery path is in the content text.
  await interaction.editReply({
    content: `${DASHBOARD_MESSAGES.SESSION_EXPIRED} Use \`/deny browse\` to view entries again.`,
    embeds: [],
    components: [], // intentionally-raw: see file-top UX note.
  });
}

/** Get session or reply with expired message. Returns null if expired. */
async function getSessionOrExpired(
  interaction: { user: { id: string }; editReply: ButtonInteraction['editReply'] },
  entryId: string
): Promise<DenyDetailSession | null> {
  const session = await getSessionManager().get<DenyDetailSession>(
    interaction.user.id,
    ENTITY_TYPE,
    entryId
  );
  if (session === null) {
    await replyExpired(interaction);
    return null;
  }
  return session.data;
}

/**
 * Show the detail view for an entry.
 * Called from browse select handler and internal refreshes.
 */
export async function showDetailView(
  interaction: {
    user: { id: string };
    editReply: ButtonInteraction['editReply'];
    channelId: string | null;
    message?: { id: string };
    guildId: string | null;
  },
  entry: DenylistEntryResponse,
  browseContext: BrowseContext | null,
  content?: string
): Promise<void> {
  const sessionData: DenyDetailSession = {
    id: entry.id,
    type: entry.type,
    discordId: entry.discordId,
    scope: entry.scope,
    scopeId: entry.scopeId,
    mode: entry.mode,
    reason: entry.reason,
    addedAt: entry.addedAt,
    addedBy: entry.addedBy,
    browseContext,
    guildId: interaction.guildId ?? null,
  };

  await getSessionManager().set({
    userId: interaction.user.id,
    entityType: ENTITY_TYPE,
    entityId: entry.id,
    data: sessionData,
    messageId: interaction.message?.id ?? 'ephemeral',
    channelId: interaction.channelId ?? '',
  });

  await interaction.editReply({
    content: content ?? '',
    embeds: [buildDetailEmbed(entry)],
    components: buildDetailButtons(entry.id, entry.mode),
  });
}

/** Handle mode toggle button */
async function handleModeToggle(interaction: ButtonInteraction, entryId: string): Promise<void> {
  const data = await getSessionOrExpired(interaction, entryId);
  if (data === null) {
    return;
  }

  const newMode = data.mode === 'BLOCK' ? 'MUTE' : 'BLOCK';

  try {
    const response = await adminPostJson(
      '/admin/denylist',
      {
        type: data.type,
        discordId: data.discordId,
        scope: data.scope,
        scopeId: data.scopeId,
        mode: newMode,
        reason: data.reason ?? undefined,
      },
      interaction.user.id
    );

    if (!response.ok) {
      // intentionally-raw: deny uses manual re-render for back-to-browse (see
      // file-top comment); terminal error path, session remains for retry.
      await interaction.editReply({
        content: DASHBOARD_MESSAGES.OPERATION_FAILED('toggle mode'),
        embeds: [],
        components: [], // intentionally-raw: see file-top UX note.
      });
      return;
    }

    data.mode = newMode;
    await getSessionManager().update<DenyDetailSession>(interaction.user.id, ENTITY_TYPE, entryId, {
      mode: newMode,
    });

    await interaction.editReply({
      embeds: [buildDetailEmbed({ ...data })],
      components: buildDetailButtons(entryId, newMode),
    });
  } catch (error) {
    logger.error({ err: error }, '[Deny] Failed to toggle mode');
    // intentionally-raw: terminal exception path; see file-top comment for
    // why deny doesn't use renderTerminalScreen's Back-to-Browse pattern.
    await interaction.editReply({
      content: DASHBOARD_MESSAGES.OPERATION_FAILED('toggle mode'),
      embeds: [],
      components: [], // intentionally-raw: see file-top UX note.
    });
  }
}

/** Handle delete button — show confirmation */
async function handleDelete(interaction: ButtonInteraction, entryId: string): Promise<void> {
  const data = await getSessionOrExpired(interaction, entryId);
  if (data === null) {
    return;
  }

  const { embed, components } = buildDeleteConfirmation({
    entityType: 'Denylist Entry',
    entityName: `${data.type} ${data.discordId} (${data.scope})`,
    confirmCustomId: `deny::confirm-del::${entryId}`,
    cancelCustomId: `deny::cancel-del::${entryId}`,
  });

  await interaction.editReply({ embeds: [embed], components });
}

/** Handle confirm delete */
async function handleConfirmDelete(interaction: ButtonInteraction, entryId: string): Promise<void> {
  const data = await getSessionOrExpired(interaction, entryId);
  if (data === null) {
    return;
  }

  const postActionSession = {
    userId: interaction.user.id,
    entityType: 'deny' as const,
    entityId: entryId,
    // `/deny view`-sourced sessions carry null here — the post-action helper
    // sees `undefined` and falls through to terminal cleanup (no fake browse
    // rebuild of a list the user never saw).
    browseContext: data.browseContext ?? undefined,
  };

  try {
    const segments = [data.type, data.discordId, data.scope, data.scopeId].map(encodeURIComponent);
    const response = await adminFetch(`/admin/denylist/${segments.join('/')}`, {
      method: 'DELETE',
      userId: interaction.user.id,
    });

    if (!response.ok && response.status !== 404) {
      await renderPostActionScreen({
        interaction,
        session: postActionSession,
        outcome: { kind: 'error', content: DASHBOARD_MESSAGES.OPERATION_FAILED('delete entry') },
      });
      return;
    }

    await renderPostActionScreen({
      interaction,
      session: postActionSession,
      outcome: {
        kind: 'success',
        banner: formatSuccessBanner('Deleted denylist entry', `${data.type} \`${data.discordId}\``),
      },
    });
  } catch (error) {
    logger.error({ err: error }, '[Deny] Failed to delete entry');
    await renderPostActionScreen({
      interaction,
      session: postActionSession,
      outcome: { kind: 'error', content: DASHBOARD_MESSAGES.OPERATION_FAILED('delete entry') },
    });
  }
}

/** Handle cancel delete — return to detail view */
async function handleCancelDelete(interaction: ButtonInteraction, entryId: string): Promise<void> {
  const data = await getSessionOrExpired(interaction, entryId);
  if (data === null) {
    return;
  }

  await interaction.editReply({
    embeds: [buildDetailEmbed({ ...data })],
    components: buildDetailButtons(entryId, data.mode),
  });
}

// handleBack was deleted in favor of the shared `handleSharedBackButton`
// (utils/dashboard/sharedBackButtonHandler.ts) — routed to from the switch
// in handleDetailButton below. The browse rebuilder registered in
// `./browse.js` owns the fetchEntries + buildBrowseResponse path.

/** Route detail button interactions */
export async function handleDetailButton(interaction: ButtonInteraction): Promise<void> {
  if (!isBotOwner(interaction.user.id)) {
    return;
  }

  const parsed = parseDashboardCustomId(interaction.customId);
  if (parsed === null) {
    return;
  }

  const { action, entityId } = parsed;
  if (entityId === undefined) {
    return;
  }

  // Edit shows a modal (no deferUpdate before showModal)
  if (action === 'edit') {
    await handleEdit(interaction, entityId);
    return;
  }

  await interaction.deferUpdate();

  switch (action) {
    case 'mode':
      await handleModeToggle(interaction, entityId);
      break;
    case 'del':
      await handleDelete(interaction, entityId);
      break;
    case 'confirm-del':
      await handleConfirmDelete(interaction, entityId);
      break;
    case 'cancel-del':
      await handleCancelDelete(interaction, entityId);
      break;
    case 'back':
      // handleDetailButton calls deferUpdate above — handleSharedBackButton
      // intentionally does NOT re-defer. Calling deferUpdate twice throws
      // InteractionAlreadyReplied, so the shared helper trusts its callers.
      await handleSharedBackButton(interaction, 'deny', entityId);
      break;
    default:
      logger.warn({ action, entityId }, '[Deny] Unknown detail action');
  }
}

/** Handle edit modal submission */
export async function handleDetailModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!isBotOwner(interaction.user.id)) {
    return;
  }

  const parsed = parseDashboardCustomId(interaction.customId);
  if (parsed === null) {
    return;
  }

  const { entityId } = parsed;
  if (entityId === undefined) {
    return;
  }

  await handleEditModal(interaction, entityId);
}
