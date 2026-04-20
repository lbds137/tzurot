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
 * Back-to-Browse UX note: unlike `/preset`, `/character`, and `/persona`, the
 * deny detail view does NOT use `renderTerminalScreen`'s Back-to-Browse
 * button pattern. `handleConfirmDelete` (success path) and `handleBack`
 * manually re-fetch entries and re-render the browse list directly, which
 * saves a click versus the Back-to-Browse + click + re-render flow the other
 * commands use. Terminal error paths in this file are intentionally plain
 * `editReply({ components: [] })` — see each site's `intentionally-raw:`
 * marker for the per-site reason. This file is in ENFORCED_FILES so any NEW
 * terminal path must either use `renderTerminalScreen` or add its own marker.
 */

import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, isBotOwner } from '@tzurot/common-types';
import { getSessionManager } from '../../utils/dashboard/SessionManager.js';
import { buildDeleteConfirmation } from '../../utils/dashboard/deleteConfirmation.js';
import { DASHBOARD_MESSAGES } from '../../utils/dashboard/messages.js';
import { parseDashboardCustomId } from '../../utils/dashboard/types.js';
import { adminPostJson, adminFetch } from '../../utils/adminApiClient.js';
import type { DenylistEntryResponse, DenyBrowseFilter } from './browse.js';
import type { DenyDetailSession } from './detailTypes.js';
import { ENTITY_TYPE, buildDetailEmbed, buildDetailButtons } from './detailTypes.js';
import { handleEdit, handleEditModal } from './detailEdit.js';

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
  browseContext: { page: number; filter: string; sort: string },
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

  try {
    const segments = [data.type, data.discordId, data.scope, data.scopeId].map(encodeURIComponent);
    const response = await adminFetch(`/admin/denylist/${segments.join('/')}`, {
      method: 'DELETE',
      userId: interaction.user.id,
    });

    if (!response.ok && response.status !== 404) {
      // intentionally-raw: delete-API-failure terminal path; session still
      // valid so user can retry. Deny doesn't use Back-to-Browse button.
      await interaction.editReply({
        content: DASHBOARD_MESSAGES.OPERATION_FAILED('delete entry'),
        embeds: [],
        components: [], // intentionally-raw: see file-top UX note.
      });
      return;
    }

    await getSessionManager().delete(interaction.user.id, ENTITY_TYPE, entryId);

    // Try to return to browse list instead of dead-ending
    const { fetchEntries, buildBrowseResponse } = await import('./browse.js');
    const entries = await fetchEntries(interaction.user.id);
    if (entries !== null && entries.length > 0) {
      const ctx = data.browseContext;
      const { embed, components } = buildBrowseResponse(
        entries,
        ctx.page,
        ctx.filter as DenyBrowseFilter,
        ctx.sort as 'name' | 'date'
      );
      await interaction.editReply({
        content: `\u2705 Denylist entry for ${data.type} \`${data.discordId}\` has been deleted.`,
        embeds: [embed],
        components,
      });
      return;
    }

    // intentionally-raw: delete succeeded + browse list is now empty — no
    // meaningful browse to go back to, clean terminal is correct.
    await interaction.editReply({
      content: `\u2705 Denylist entry for ${data.type} \`${data.discordId}\` has been deleted. No entries remaining.`,
      embeds: [],
      components: [], // intentionally-raw: see file-top UX note.
    });
  } catch (error) {
    logger.error({ err: error }, '[Deny] Failed to delete entry');
    // intentionally-raw: delete-exception terminal path; session already
    // cleaned up so no retry possible. Clean terminal per file-top UX note.
    await interaction.editReply({
      content: DASHBOARD_MESSAGES.OPERATION_FAILED('delete entry'),
      embeds: [],
      components: [], // intentionally-raw: see file-top UX note.
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

/** Handle back button — return to browse list */
async function handleBack(interaction: ButtonInteraction, entryId: string): Promise<void> {
  const data = await getSessionOrExpired(interaction, entryId);
  if (data === null) {
    return;
  }

  await getSessionManager().delete(interaction.user.id, ENTITY_TYPE, entryId);

  const { fetchEntries, buildBrowseResponse } = await import('./browse.js');
  const entries = await fetchEntries(interaction.user.id);
  if (entries === null) {
    // intentionally-raw: back-to-browse itself failed; adding a Back-to-Browse
    // button would just loop into the same failing fetch. Clean terminal.
    await interaction.editReply({
      content: '\u274C Failed to fetch denylist entries.',
      embeds: [],
      components: [], // intentionally-raw: see file-top UX note.
    });
    return;
  }

  const ctx = data.browseContext;
  const { embed, components } = buildBrowseResponse(
    entries,
    ctx.page,
    ctx.filter as DenyBrowseFilter,
    ctx.sort as 'name' | 'date'
  );
  await interaction.editReply({ embeds: [embed], components });
}

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
      await handleBack(interaction, entityId);
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
