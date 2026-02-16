/**
 * Deny Detail View
 *
 * Shows a detailed view of a single denylist entry with options to
 * toggle mode, edit scope/reason, or delete. Uses Redis-backed sessions
 * for state management.
 *
 * UI builders and types are in detailTypes.ts.
 * Edit modal handlers are in detailEdit.ts.
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
  await interaction.editReply({
    content: `${DASHBOARD_MESSAGES.SESSION_EXPIRED} Use \`/deny browse\` to view entries again.`,
    embeds: [],
    components: [],
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
      await interaction.editReply({
        content: DASHBOARD_MESSAGES.OPERATION_FAILED('toggle mode'),
        embeds: [],
        components: [],
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
    await interaction.editReply({
      content: DASHBOARD_MESSAGES.OPERATION_FAILED('toggle mode'),
      embeds: [],
      components: [],
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
      await interaction.editReply({
        content: DASHBOARD_MESSAGES.OPERATION_FAILED('delete entry'),
        embeds: [],
        components: [],
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

    await interaction.editReply({
      content: `\u2705 Denylist entry for ${data.type} \`${data.discordId}\` has been deleted. No entries remaining.`,
      embeds: [],
      components: [],
    });
  } catch (error) {
    logger.error({ err: error }, '[Deny] Failed to delete entry');
    await interaction.editReply({
      content: DASHBOARD_MESSAGES.OPERATION_FAILED('delete entry'),
      embeds: [],
      components: [],
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
    await interaction.editReply({
      content: '\u274C Failed to fetch denylist entries.',
      embeds: [],
      components: [],
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
